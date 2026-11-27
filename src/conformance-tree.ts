import { FsTree } from "nx/src/generators/tree";

export class ConformanceTree extends FsTree {
  protected isReadOnly: boolean;

  constructor(
    root: string,
    verbose: boolean,
    operationId?: string,
    readOnly = true,
  ) {
    super(root, verbose, operationId);
    this.isReadOnly = readOnly;
  }

  listChanges() {
    return this.isReadOnly ? [] : super.listChanges();
  }

  private assertWritable(operation: string): void {
    if (this.isReadOnly)
      throw new Error(
        operation +
          " is not available on a ConformanceTree within a rule implementation. Changes to the workspace should be applied via a rule's fixGenerator tree instead.",
      );
  }

  write(...args: Parameters<FsTree["write"]>) {
    this.assertWritable("tree.write");
    return super.write(...args);
  }
  delete(...args: Parameters<FsTree["delete"]>) {
    this.assertWritable("tree.delete");
    return super.delete(...args);
  }
  rename(...args: Parameters<FsTree["rename"]>) {
    this.assertWritable("tree.rename");
    return super.rename(...args);
  }
  changePermissions(...args: Parameters<FsTree["changePermissions"]>) {
    this.assertWritable("tree.changePermissions");
    return super.changePermissions(...args);
  }
}

export class ReadOnlyConformanceTree extends ConformanceTree {
  private readonly READ_ONLY = true;
  constructor(root: string, verbose: boolean, operationId?: string) {
    super(root, verbose, operationId, true);
  }
}

export class WritableConformanceTree extends ConformanceTree {
  private readonly WRITABLE = true;
  constructor(root: string, verbose: boolean, operationId?: string) {
    super(root, verbose, operationId, false);
  }
}

export function convertToReadOnly(
  tree: ConformanceTree,
): ReadOnlyConformanceTree {
  (tree as unknown as { isReadOnly: boolean }).isReadOnly = true;
  return tree as ReadOnlyConformanceTree;
}

export function convertToWritable(
  tree: ConformanceTree,
): WritableConformanceTree {
  (tree as unknown as { isReadOnly: boolean }).isReadOnly = false;
  return tree as WritableConformanceTree;
}
