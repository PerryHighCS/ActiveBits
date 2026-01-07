// Fractal data helpers for Triangulon Invasion (activity-local, not global server)
// Index scheme: ternary heap. Root = 0. Children of i => 3*i + 1, 3*i + 2, 3*i + 3. Parent of i>0 => Math.floor((i - 1) / 3).

function getParentIndex(index) {
  if (index <= 0) return null;
  return Math.floor((index - 1) / 3);
}

function getChildrenIndices(index) {
  const base = 3 * index + 1;
  return [base, base + 1, base + 2];
}

function getDepth(index) {
  if (index === 0) return 0;
  // Depth d satisfies index < (3^(d + 1) - 1) / 2
  let depth = 0;
  let maxIndexAtDepth = 0;
  while (index > maxIndexAtDepth) {
    depth += 1;
    maxIndexAtDepth = (3 ** (depth + 1) - 1) / 2 - 1;
  }
  return depth;
}

class FractalStore {
  constructor() {
    // Sparse map: key = index, value = node data { owner, createdAt, meta }
    this.nodes = new Map();
  }

  has(index) {
    return this.nodes.has(index);
  }

  get(index) {
    return this.nodes.get(index) || null;
  }

  // Create/claim a node; ensures parent exists unless root.
  addNode(index, data) {
    if (index < 0) throw new Error('Index must be non-negative');
    if (index !== 0 && !this.nodes.has(getParentIndex(index))) {
      throw new Error('Parent must exist before creating a child');
    }
    const node = {
      owner: data.owner || null,
      createdAt: data.createdAt || Date.now(),
      meta: data.meta || {},
    };
    this.nodes.set(index, node);
    return node;
  }

  // Return sibling indices for an index (only those present if filterExisting=true)
  getSiblings(index, { filterExisting = true } = {}) {
    const parent = getParentIndex(index);
    if (parent === null) return [];
    const sibs = getChildrenIndices(parent);
    if (filterExisting) return sibs.filter((i) => this.nodes.has(i));
    return sibs;
  }

  // Serialize to compact payload [[index, node], ...]
  toPayload() {
    return Array.from(this.nodes.entries());
  }

  // Load from payload [[index, node], ...]
  static fromPayload(payload) {
    const store = new FractalStore();
    for (const [idx, node] of payload || []) {
      store.nodes.set(Number(idx), node);
    }
    return store;
  }
}

module.exports = {
  FractalStore,
  getParentIndex,
  getChildrenIndices,
  getDepth,
};
