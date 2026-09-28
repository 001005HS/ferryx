export function disambiguateFileTabLabels(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];

  const segmented = paths.map((p) => {
    const rawSegments = p.split(/[/\\]/);
    const segments = rawSegments.filter((seg) => seg.length > 0);
    return {
      raw: p,
      segments: segments.length > 0 ? segments : [p],
    };
  });

  const basenameGroups = new Map<string, number[]>();
  for (let i = 0; i < segmented.length; i++) {
    const segs = segmented[i].segments;
    const basename = segs[segs.length - 1];
    const group = basenameGroups.get(basename);
    if (!group) {
      basenameGroups.set(basename, [i]);
    } else {
      group.push(i);
    }
  }

  const result: string[] = new Array(paths.length);

  for (const group of basenameGroups.values()) {
    if (group.length === 1) {
      const idx = group[0];
      const segs = segmented[idx].segments;
      result[idx] = segs[segs.length - 1];
      continue;
    }

    const allIdentical = group.every(
      (idx) => paths[idx] === paths[group[0]],
    );
    if (allIdentical) {
      const idx = group[0];
      const segs = segmented[idx].segments;
      const baseLabel = segs[segs.length - 1];
      for (const i of group) {
        result[i] = baseLabel;
      }
      continue;
    }

    for (const idx of group) {
      const segs = segmented[idx].segments;
      const otherGroupIndices = group.filter((j) => paths[j] !== paths[idx]);

      if (otherGroupIndices.length === 0) {
        result[idx] = segs[segs.length - 1];
        continue;
      }

      let k = 1;
      while (true) {
        const mySuffix = segs.slice(Math.max(0, segs.length - k)).join("/");
        const conflicts = otherGroupIndices.some((otherIdx) => {
          const otherSegs = segmented[otherIdx].segments;
          const otherSuffix = otherSegs
            .slice(Math.max(0, otherSegs.length - k))
            .join("/");
          return otherSuffix === mySuffix;
        });

        if (!conflicts || k >= segs.length) {
          result[idx] = mySuffix;
          break;
        }
        k++;
      }
    }
  }

  return result;
}
