import {
  withDesignRevision,
  type SchematicDocument,
} from "./schematic";

export interface CommandTransaction {
  id: string;
  commandId: string;
  before: SchematicDocument;
  after: SchematicDocument;
  selectionBefore: string[];
  selectionAfter: string[];
  timestamp: number;
}

export interface ExecuteOptions {
  selectionBefore?: string[];
  selectionAfter?: string[];
  connectivityAffected?: boolean;
  transactionId?: string;
  timestamp?: number;
}

function cloneDocument(document: SchematicDocument): SchematicDocument {
  return structuredClone(document);
}

export class DesignStore {
  private current: SchematicDocument;
  private readonly undoStack: CommandTransaction[] = [];
  private readonly redoStack: CommandTransaction[] = [];
  private transactionSequence = 0;

  constructor(document: SchematicDocument, private readonly capacity = 100) {
    this.current = cloneDocument(document);
  }

  get document(): SchematicDocument {
    return cloneDocument(this.current);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  execute(
    commandId: string,
    mutate: (document: SchematicDocument) => SchematicDocument,
    options: ExecuteOptions = {},
  ): CommandTransaction | null {
    const before = cloneDocument(this.current);
    const proposed = mutate(cloneDocument(before));
    if (JSON.stringify(proposed) === JSON.stringify(before)) return null;
    const after = withDesignRevision(
      proposed,
      options.connectivityAffected ?? true,
    );
    this.transactionSequence += 1;
    const transaction: CommandTransaction = {
      id: options.transactionId ?? `tx_${this.transactionSequence}`,
      commandId,
      before,
      after: cloneDocument(after),
      selectionBefore: [...(options.selectionBefore ?? [])],
      selectionAfter: [...(options.selectionAfter ?? [])],
      timestamp: options.timestamp ?? Date.now(),
    };
    this.current = after;
    this.undoStack.push(transaction);
    if (this.undoStack.length > this.capacity) this.undoStack.shift();
    this.redoStack.length = 0;
    return transaction;
  }

  undo(): CommandTransaction | null {
    const transaction = this.undoStack.pop();
    if (!transaction) return null;
    this.current = cloneDocument(transaction.before);
    this.redoStack.push(transaction);
    return transaction;
  }

  redo(): CommandTransaction | null {
    const transaction = this.redoStack.pop();
    if (!transaction) return null;
    this.current = cloneDocument(transaction.after);
    this.undoStack.push(transaction);
    return transaction;
  }

  replace(document: SchematicDocument) {
    this.current = cloneDocument(document);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
