import { joinPathFragments } from "@nx/devkit";
import type {
  DependencyType,
  ProjectGraph,
  ProjectGraphProjectNode,
} from "@nx/devkit";
import type { FileMapCache } from "nx/src/project-graph/nx-deps-cache";
import { convertToReadOnly, convertToWritable } from "../src/conformance-tree";
import type {
  ReadOnlyConformanceTree,
  WritableConformanceTree,
} from "../src/conformance-tree";

export interface ProjectNodesWithFiles {
  projectNode: ProjectGraphProjectNode;
  projectFiles?: Array<{
    projectRootRelativeFile: string;
    depsItCreates: (string | [string, DependencyType])[];
  }>;
}

export function applyProjectNodesAndFiles(
  tree: ReadOnlyConformanceTree | WritableConformanceTree,
  projectGraph: ProjectGraph,
  fileMapCache: FileMapCache,
  nodes: ProjectNodesWithFiles[],
): void {
  const readOnly = (tree as unknown as { isReadOnly: boolean }).isReadOnly;
  const writable = convertToWritable(tree);
  try {
    for (const { projectNode, projectFiles = [] } of nodes) {
      const name = projectNode.name;
      projectGraph.nodes[name] = projectNode;
      for (const { projectRootRelativeFile, depsItCreates } of projectFiles) {
        const file = joinPathFragments(
          projectNode.data.root,
          projectRootRelativeFile,
        );
        writable.write(file, "");
        projectGraph.dependencies[name] ??= [];
        projectGraph.dependencies[name].push(
          ...depsItCreates.map((dependency) => ({
            source: name,
            target: typeof dependency === "string" ? dependency : dependency[0],
            type: typeof dependency === "string" ? "static" : dependency[1],
          })),
        );
        fileMapCache.fileMap.projectFileMap[name] ??= [];
        fileMapCache.fileMap.projectFileMap[name].push({
          file,
          hash: "",
          deps: depsItCreates,
        });
      }
    }
  } finally {
    if (readOnly) convertToReadOnly(tree);
  }
}

export async function createStubbedProjectGraphAndFileMapCache(
  tree: ReadOnlyConformanceTree | WritableConformanceTree,
  nodes: ProjectNodesWithFiles[],
): Promise<{ projectGraph: ProjectGraph; fileMapCache: FileMapCache }> {
  const projectGraph: ProjectGraph = { nodes: {}, dependencies: {} };
  const fileMapCache: FileMapCache = {
    version: "",
    nxVersion: "",
    pathMappings: {},
    nxJsonPlugins: [],
    fileMap: { nonProjectFiles: [], projectFileMap: {} },
  };
  applyProjectNodesAndFiles(tree, projectGraph, fileMapCache, nodes);
  return { projectGraph, fileMapCache };
}
