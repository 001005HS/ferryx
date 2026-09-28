import { clampRatio, type PaneDirection } from "./paneTree";

type Split<Node> = Node & {
  type: "split";
  direction: PaneDirection;
  first: Node;
  second: Node;
  ratio: number;
};

export function equalizeSplitRun<Node>(
  root: Node,
  targetPath: string,
  isSplit: (node: Node) => node is Split<Node>,
): Node {
  const segments = targetPath.split(".").filter(Boolean);
  let target = root;
  for (const segment of segments) {
    if (!isSplit(target) || (segment !== "first" && segment !== "second")) return root;
    target = target[segment];
  }
  if (!isSplit(target)) return root;

  let scopeDepth = 0;
  let ancestor = root;
  for (let index = 0; index < segments.length; index++) {
    if (!isSplit(ancestor)) return root;
    if (ancestor.direction !== target.direction) scopeDepth = index + 1;
    const segment = segments[index];
    ancestor = segment === "first" ? ancestor.first : ancestor.second;
  }

  const count = (node: Node): number =>
    isSplit(node) && node.direction === target.direction
      ? count(node.first) + count(node.second)
      : 1;

  const equalize = (node: Node): Node => {
    if (!isSplit(node) || node.direction !== target.direction) return node;
    const first = equalize(node.first);
    const second = equalize(node.second);
    const ratio = clampRatio(count(node.first) / (count(node.first) + count(node.second)));
    return first === node.first && second === node.second && ratio === node.ratio
      ? node
      : { ...node, first, second, ratio };
  };

  const update = (node: Node, depth: number): Node => {
    if (depth === scopeDepth) return equalize(node);
    if (!isSplit(node)) return node;
    const segment = segments[depth] === "first" ? "first" : "second";
    const child = segment === "first" ? update(node.first, depth + 1) : update(node.second, depth + 1);
    return child === node[segment] ? node : { ...node, [segment]: child };
  };

  return update(root, 0);
}
