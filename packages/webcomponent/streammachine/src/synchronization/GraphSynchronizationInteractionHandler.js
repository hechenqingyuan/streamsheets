import JSG from '@cedalo/jsg-ui';

// import * as Actions from '../../actions/actions';
import CommandStack from './CommandStack';


const {
	DeleteTreeItemCommand,
	InteractionHandler,
	ItemAttributes,
	OutboxContainer,
	StreamSheet,
	SetSelectionCommand,
	TreeItemsNode,
	SetAttributeAtPathCommand,
	MachineGraph,
	Expression,
	CompoundCommand,
	SetGraphCellsCommand,
	AttributeUtils,
} = JSG;

const SELECTION_TYPE_PROCESS_SHEET = 'process_sheet';
const SELECTION_TYPE_INBOX_MESSAGE_LIST = 'inbox_message_list';
const SELECTION_TYPE_INBOX_MESSAGE_ELEMENTS = 'inbox_message_elements';
const SELECTION_TYPE_OUTBOX_MESSAGE_LIST = 'outbox_message_list';
const SELECTION_TYPE_OUTBOX_MESSAGE_ELEMENTS = 'outbox_message_elements';

export default class GraphSynchronizationInteractionHandler extends InteractionHandler {
	constructor(viewer, graph, streamMachine) {
		super(viewer);
		this.graph = graph;
		this.graph.context = {};
		this.streamMachine = streamMachine;
		this.commandStack = new CommandStack();
	}

	execute(command, completionFunction) {
		this.handleCustomFields(command);
		super.execute(command, completionFunction);
		const commandJSON = command.toObject();
		if (!this.isSelectionInOutbox(command._graphItem)) {
			const streamsheetId = this.getStreamSheetId(command);
			if (streamsheetId) {
				commandJSON.streamsheetId = streamsheetId;
			}
		}
		this.streamMachine.sendCommand(commandJSON);

		if (commandJSON.name !== 'command.RemoveSelectionCommand' &&
			commandJSON.name !== 'command.SetSelectionCommand') {
			this.updateGraphItems();
		}
	}

	updateGraphItems() {
		const cmp = new CompoundCommand();
		const formulas = this.graph.getGraphItemFormulas();
		const path = AttributeUtils.createPath(ItemAttributes.NAME, "sheetformula");
		let sheet;

		cmp.isVolatile = true;

		Object.values(formulas).forEach((value) => {
			if (value.formula) {
				const cmd = new SetAttributeAtPathCommand(value.item, path, new Expression(0, value.formula));
				cmd.isVolatile = true;
				cmp.add(cmd);
			}
			({ sheet } = value);
		});

		if (!sheet) {
			return;
		}

		this.graph.resetGraphItemFormulas();

		this.execute(cmp);
		this.execute(new SetGraphCellsCommand(sheet, sheet.getGraphDescriptors()));
	}

	isSelectionInOutbox(graphItem) {
		let parent = graphItem && !(graphItem instanceof MachineGraph) ? graphItem.getParent() : undefined;
		while (parent) {
			if (parent instanceof OutboxContainer) break;
			parent = parent.getParent();
		}
		return !!parent; // graphItem && !(graphItem instanceof MachineGraph) && graphItem.getParent().getParent().getParent() instanceof OutboxContainer;
	}

	handleCustomFields(command) {
		if (command instanceof SetSelectionCommand) {
			const graphItem = command._graphItem;
			const messageId = command._data;
			const jsonPath = command._content;
			const selectionType = this.getSelectionType(graphItem);
			const processSheet = this.getStreamSheet(graphItem);
			const streamsheetId = processSheet ? this.getStreamSheetIdFromProcessSheet(processSheet) : undefined;
			const custom = {
				streamsheetId,
				selectionType,
			};
			switch (selectionType) {
			case SELECTION_TYPE_INBOX_MESSAGE_LIST:
				custom.messageId = messageId;
				this.graph.context.currentSelectedInboxMessage = messageId;
				break;
			case SELECTION_TYPE_INBOX_MESSAGE_ELEMENTS:
				custom.messageId = this.graph.context.currentSelectedInboxMessage;
				custom.jsonPath = jsonPath;
				break;
			case SELECTION_TYPE_OUTBOX_MESSAGE_LIST:
				custom.messageId = messageId;
				this.graph.context.currentSelectedOutboxMessage = messageId;
				break;
			case SELECTION_TYPE_OUTBOX_MESSAGE_ELEMENTS:
				custom.messageId = this.graph.context.currentSelectedOutboxMessage;
				custom.jsonPath = jsonPath;
				break;
			default:
				break;
			}
			command.custom = custom;
		} else if (command instanceof DeleteTreeItemCommand) {
			const graphItem = command._graphItem;
			const selectionType = this.getSelectionType(graphItem);
			const processSheet = this.getStreamSheet(graphItem);
			const streamsheetId = processSheet ? this.getStreamSheetIdFromProcessSheet(processSheet) : undefined;
			const custom = {
				streamsheetId,
			};
			switch (selectionType) {
			case SELECTION_TYPE_INBOX_MESSAGE_LIST:
				custom.messageId = this.graph.context.currentSelectedInboxMessage;
				custom.messageBox = 'inbox';
				break;
			case SELECTION_TYPE_OUTBOX_MESSAGE_LIST:
				custom.messageId = this.graph.context.currentSelectedOutboxMessage;
				custom.messageBox = 'outbox';
				break;
			default:
				break;
			}
			command.custom = custom;
		}
	}

	getSelectionType(graphItem) {
		let selectionType = null;
		if (graphItem instanceof StreamSheet) {
			selectionType = SELECTION_TYPE_PROCESS_SHEET;
		} else if (graphItem instanceof TreeItemsNode) {
			const isOutbox = graphItem.getParent().getParent().getParent() instanceof OutboxContainer;
			const type = graphItem.getParent().getParent().getType().getValue();
			if (isOutbox) {
				if (type === 'ml') {
					selectionType = SELECTION_TYPE_OUTBOX_MESSAGE_LIST;
				} else if (type === 'me') {
					selectionType = SELECTION_TYPE_OUTBOX_MESSAGE_ELEMENTS;
				}
			} else {
				// eslint-disable-next-line
				if (type === 'ml') {
					selectionType = SELECTION_TYPE_INBOX_MESSAGE_LIST;
				} else if (type === 'me') {
					selectionType = SELECTION_TYPE_INBOX_MESSAGE_ELEMENTS;
				}
			}
		}
		return selectionType;
	}

	getStreamSheetId(command) {
		const processSheet = this.getProcessSheetFromCommand(command);
		const streamsheetId = this.getStreamSheetIdFromProcessSheet(processSheet);
		return streamsheetId;
	}

	getProcessSheetFromCommand(command) {
		return this.getStreamSheet(command._graphItem)
			|| command.sheet
			|| (command.commands ? command.commands.reduce((sheet, cmd) => sheet || cmd.sheet, null) : undefined);
	}

	getStreamSheet(graphItem) {
		let processSheet = null;
		if (graphItem instanceof StreamSheet) {
			processSheet = graphItem;
		} else if (graphItem instanceof TreeItemsNode) {
			const parent = graphItem.getParent().getParent().getParent();
			if (!(parent instanceof OutboxContainer)) {
				processSheet = parent.getParent().getStreamSheet();
			}
		}
		return processSheet;
	}

	getStreamSheetIdFromProcessSheet(processSheet) {
		const processSheetContainer = processSheet && processSheet.getStreamSheetContainer();
		return (processSheetContainer && processSheetContainer instanceof JSG.StreamSheetContainer) ?
			processSheetContainer.getStreamSheetContainerAttributes().getSheetId().getValue() : undefined;
	}

	baseExecute(cmd, graphWrapper, completionfunc) {
		this.graphWrapper = graphWrapper;
		const state = JSG.drawingDisabled;
		JSG.setDrawingDisabled(true);
		this.commandStack.execute(cmd);
		if (completionfunc !== undefined) {
			completionfunc.call(this, cmd, this.viewer);
		}
		// mark interaction context:
		cmd._interaction = this.getActiveInteraction();
		if (cmd._keepFeedback !== true) {
			this.viewer.getGraphView().clearFeedback();
		}
		this.viewer.getGraph().setChanged(true);
		JSG.setDrawingDisabled(state);
	}

	/**
	 * Method to perform a synchronized undo.
	 *
	 */
	undo() {
		const command = this.commandStack.undo();
		this.baseUndo(command);
		if (command !== undefined) {
			if (!this.isSelectionInOutbox(command._graphItem)) {
				const streamsheetId = this.getStreamSheetId(command);
				const commandJSON = command.toObject();
				if (streamsheetId) {
					commandJSON.streamsheetId = streamsheetId;
				}
				this.streamMachine.sendCommand(commandJSON, true, false);
			}
		}
		return command;
	}

	/**
	 * Method to perform an unsynchronized undo.
	 *
	 * @param {Command} command
	 */
	baseUndo(command) {
		JSG.setDrawingDisabled(true);
		if (command !== undefined) {
			command.undo();
			const selection = [];
			command.doAfterUndo(selection, this.viewer);
			if (selection.length > 0) {
				command.selectAll(selection, this.viewer);
			}
			if (command._interaction !== this.getActiveInteraction()) {
				command._interaction = undefined;
				this.setActiveInteraction(this.viewer.getDefaultInteraction());
			}
		}
		this.viewer.getGraph().setChanged(true);
		JSG.setDrawingDisabled(false);
		this.repaint();
	}

	/**
	 * Method to perform a synchronized redo.
	 *
	 */
	redo() {
		const command = this.commandStack.redo();
		this.baseRedo(command);
		if (command !== undefined) {
			if (!this.isSelectionInOutbox(command._graphItem)) {
				const streamsheetId = this.getStreamSheetId(command);
				const commandJSON = command.toObject();
				if (streamsheetId) {
					commandJSON.streamsheetId = streamsheetId;
				}
				this.streamMachine.sendCommand(commandJSON, false, true);
			}
		}
		return command;
	}

	/**
	 * Method to perform an unsynchronized redo.
	 *
	 * @param {Command} command
	 */
	baseRedo(command) {
		JSG.setDrawingDisabled(true);
		if (command !== undefined) {
			command.redo();
			const selection = [];
			command.doAfterRedo(selection, this.viewer);
			if (selection.length > 0) {
				command.selectAll(selection, this.viewer);
			}
			if (command._interaction !== this.getActiveInteraction()) {
				command._interaction = undefined;
				this.setActiveInteraction(this.viewer.getDefaultInteraction());
			}
		}
		this.viewer.getGraph().setChanged(true);
		JSG.setDrawingDisabled(false);
		this.repaint();
	}

	onSelectionChanged() {
		const selection = this.viewer.getSelection();
		const message = {};
		// TODO: include id of client in message
		message.client = 'client123456';
		message.graphId = this.graph.getType().getValue();
		message.selections = [];
		selection.forEach((controller) => {
			message.selections.push(controller.getModel().getId());
		});
		// Actions.sendSelection(message);
	}
}
