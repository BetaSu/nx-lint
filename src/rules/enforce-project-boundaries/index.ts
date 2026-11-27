import { createConformanceRule } from "../../utils/create-conformance-rule";
import { findMatchingProjects } from "nx/src/utils/find-matching-projects";
import { fileDataDepTarget } from "nx/src/config/project-graph";
import type { ProjectGraph, ProjectGraphProjectNode } from "@nx/devkit";
export interface EnforceProjectBoundariesOptions {
  requireBuildableDependenciesForBuildableProjects?:
    boolean | { buildTargetNames: string[] };
  ignoredCircularDependencies?: [string, string][];
  depConstraints?: Array<
    ({ sourceTag: string } | { allSourceTags: string[] }) & {
      onlyDependOnProjectsWithTags?: string[];
      notDependOnProjectsWithTags?: string[];
    }
  >;
  checkDynamicDependenciesExceptions?: string[];
}
type Constraint = NonNullable<
  EnforceProjectBoundariesOptions["depConstraints"]
>[number];
type GraphIndex = {
  graph: ProjectGraph;
  adjacent: Record<string, string[]>;
  reach: Record<string, Set<string>>;
};
let lastGraphIndex: GraphIndex | undefined;
const tagPatterns = new Map<string, RegExp>();

function hasTag(node: ProjectGraphProjectNode, pattern: string): boolean {
  if (pattern === "*") return true;
  const tags = node.data.tags ?? [];
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    if (!tagPatterns.has(pattern))
      tagPatterns.set(pattern, new RegExp(pattern.slice(1, -1)));
    return tags.some((tag) => tagPatterns.get(pattern)!.test(tag));
  }
  if (pattern.includes("*")) {
    const expression = new RegExp("^" + pattern.replace(/\.?\*+/g, ".*") + "$");
    return tags.some((tag) => expression.test(tag));
  }
  return tags.includes(pattern);
}
function indexGraph(graph: ProjectGraph): GraphIndex {
  if (lastGraphIndex?.graph === graph) return lastGraphIndex;
  const adjacent = Object.fromEntries(
    Object.keys(graph.nodes).map((name) => [
      name,
      (graph.dependencies[name] ?? [])
        .map((edge) => edge.target)
        .filter((target) => graph.nodes[target]),
    ]),
  );
  const reach: Record<string, Set<string>> = {};
  for (const name of Object.keys(graph.nodes)) {
    const seen = new Set<string>();
    const pending = [name];
    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(...adjacent[next]);
    }
    reach[name] = seen;
  }
  const index = { graph, adjacent, reach };
  lastGraphIndex = index;
  return index;
}
function pathBetween(
  graph: ProjectGraph,
  start: string,
  end: string,
): string[] {
  if (start === end) return [];
  const { adjacent, reach } = indexGraph(graph);
  const visited = new Set([start]);
  const pending = [[start]];
  while (pending.length) {
    const trail = pending.pop()!;
    const current = trail[trail.length - 1];
    if (current === end) return trail;
    for (const next of adjacent[current] ?? []) {
      if (visited.has(next) || !reach[next]?.has(end)) continue;
      visited.add(next);
      pending.push([...trail, next]);
    }
  }
  return [];
}
function ignoredEdges(graph: ProjectGraph, pairs: [string, string][]) {
  const ignored = new Map<string, Set<string>>();
  const add = (source: string, target: string) => {
    if (!ignored.has(source)) ignored.set(source, new Set());
    ignored.get(source)!.add(target);
  };
  for (const [from, to] of pairs) {
    const left = findMatchingProjects([from], graph.nodes);
    const right = findMatchingProjects([to], graph.nodes);
    for (const a of left)
      for (const b of right) {
        add(a, b);
        add(b, a);
      }
  }
  return ignored;
}
const rule = createConformanceRule<EnforceProjectBoundariesOptions>({
  name: "enforce-project-boundaries",
  category: "maintainability",
  description: "Enforce project boundaries across the workspace.",
  implementation: async ({
    projectGraph: graph,
    fileMapCache,
    ruleOptions,
  }) => {
    const options = ruleOptions;
    const violations: import("../../types").ConformanceViolation[] = [];
    let ignored: Map<string, Set<string>> | undefined;
    for (const [sourceName, dependencies] of Object.entries(
      graph.dependencies,
    )) {
      const source = graph.nodes[sourceName];
      if (!source) continue;
      for (const edge of dependencies) {
        const target = graph.nodes[edge.target];
        if (!target) continue;
        ignored ??= ignoredEdges(
          graph,
          options.ignoredCircularDependencies ?? [],
        );
        const sourceFiles =
          fileMapCache.fileMap.projectFileMap[sourceName] ?? [];
        const files = (
          edge.type === "implicit"
            ? fileMapCache.fileMap.projectFileMap[sourceName].filter((file) =>
                file.file.endsWith("project.json"),
              )
            : sourceFiles.filter((file) =>
                file.deps?.some(
                  (dependency) => fileDataDepTarget(dependency) === target.name,
                ),
              )
        ).map((file) => file.file);
        const report = (message: string) => {
          for (const file of files)
            violations.push({ sourceProject: sourceName, file, message });
        };
        if (target.type === "app" && edge.type !== "implicit")
          report(
            'A dependency on an app project is forbidden (found "' +
              target.name +
              '")',
          );
        if (target.type === "e2e")
          report(
            'A dependency on an e2e project is forbidden (found "' +
              target.name +
              '")',
          );
        if (
          options.requireBuildableDependenciesForBuildableProjects &&
          source.type === "lib" &&
          target.type === "lib"
        ) {
          const names =
            (typeof options.requireBuildableDependenciesForBuildableProjects ===
            "boolean"
              ? ["build"]
              : options.requireBuildableDependenciesForBuildableProjects
                  .buildTargetNames) ?? ["build"];
          const buildable = (node: ProjectGraphProjectNode) =>
            names.some(
              (name) =>
                node.data.targets?.[name] &&
                node.data.targets[name].executor !== "",
            );
          if (buildable(source) && !buildable(target))
            report(
              'A buildable project cannot depend on a non-buildable project (found "' +
                target.name +
                '")',
            );
        }
        const cycle = pathBetween(graph, target.name, source.name);
        if (
          cycle.length &&
          !cycle
            .slice(0, -1)
            .some((node, index) => ignored!.get(node)?.has(cycle[index + 1]))
        )
          report("Circular dependency detected: " + cycle.join(" <-> "));
        const constraints = options.depConstraints ?? [];
        const tags = (constraint: Constraint) =>
          "allSourceTags" in constraint
            ? constraint.allSourceTags
            : [constraint.sourceTag];
        if (
          constraints.length &&
          !constraints.some((constraint) =>
            tags(constraint).every((tag) => hasTag(source, tag)),
          )
        ) {
          report(
            'A project without tags matching at least one entry in depConstraints cannot depend on any other projects (found "' +
              target.name +
              '")',
          );
          continue;
        }
        // After a full source match admits the dependency, apply each constraint
        // that shares a source tag with the project.
        for (const constraint of constraints.filter((constraint) =>
          tags(constraint).some((tag) => hasTag(source, tag)),
        )) {
          const label =
            "allSourceTags" in constraint
              ? constraint.allSourceTags.join('" and "')
              : '"' + constraint.sourceTag + '"';
          const quotedTags = (values: string[]) =>
            values.map((value) => '"' + value + '"').join(", ");
          const allow = constraint.onlyDependOnProjectsWithTags;
          if (allow?.length && !allow.some((tag) => hasTag(target, tag)))
            report(
              "A project tagged with " +
                label +
                " can only depend on projects with tags: " +
                quotedTags(allow) +
                ' (found "' +
                target.name +
                '")',
            );
          if (allow && !allow.length && target.data.tags?.length)
            report(
              "A project tagged with " +
                label +
                ' cannot depend on any projects with tags (found "' +
                target.name +
                '")',
            );
          const deny = constraint.notDependOnProjectsWithTags;
          if (deny?.some((tag) => hasTag(target, tag)))
            report(
              "A project tagged with " +
                label +
                " cannot depend on any projects with tags: " +
                quotedTags(deny) +
                ' (found "' +
                target.name +
                '")',
            );
        }
      }
    }
    return { severity: "medium", details: { violations } };
  },
});

export default rule;
