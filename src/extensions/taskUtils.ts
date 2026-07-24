export function isInsideTaskItem(doc: any, pos: number): boolean {
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth >= 0; depth--) {
    if (resolved.node(depth).type.name === "taskItem") return true;
  }
  return false;
}

export function deleteWithSurroundingSpace(
  view: any,
  from: number,
  to: number,
  parentStart: number,
  parentTextLength: number
): void {
  const state = view.state;
  let delFrom = from;
  let delTo = to;

  if (to < parentStart + parentTextLength) {
    try {
      if (state.doc.textBetween(to, to + 1) === " ") delTo = to + 1;
    } catch { /* at doc boundary */ }
  }
  if (delTo === to && delFrom > parentStart) {
    try {
      if (state.doc.textBetween(from - 1, from) === " ") delFrom = from - 1;
    } catch { /* at doc boundary */ }
  }

  view.dispatch(state.tr.delete(delFrom, delTo));
}
