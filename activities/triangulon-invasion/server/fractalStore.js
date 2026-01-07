// Fractal data helpers for Triangulon Invasion (activity-local, not global server)
// Index scheme: ternary heap. Root = 0. Children of i => 3*i + 1, 3*i + 2, 3*i + 3. Parent of i>0 => Math.floor((i - 1) / 3).

/**
 * Compute the parent index in the ternary heap for a given node index.
 * Returns null for the root node.
 * @param {number} index - Heap index (0-based).
 * @returns {number|null} Parent index or null when at root.
 */
function getParentIndex(index) {
  if (index <= 0) return null;
  return Math.floor((index - 1) / 3);
}

/**
 * Compute the three child indices for a given node index in the ternary heap.
 * @param {number} index - Heap index (0-based).
 * @returns {[number, number, number]} Child indices ordered left-to-right.
 */
function getChildrenIndices(index) {
  const base = 3 * index + 1;
  return [base, base + 1, base + 2];
}

/**
 * Compute the depth (0-based) of a node index in the ternary heap.
 * Uses closed form: depth = floor(log_3(2 * index + 1)).
 * @param {number} index - Heap index (0-based).
 * @returns {number} Depth of the node.
 * @throws {Error} When index is negative.
 */
function getDepth(index) {
  if (index < 0) throw new Error('Index must be non-negative');
  if (index === 0) return 0;
  // Closed form: depth = floor(log_3(2 * index + 1))
  return Math.floor(Math.log(2 * index + 1) / Math.log(3));
}

class FractalStore {
  constructor() {
    // Sparse map: key = index, value = node data { owner, createdAt, meta }
    this.nodes = new Map();
  }

  /**
   * Check if a node exists at the given index.
   * @param {number} index - Heap index to query.
   * @returns {boolean} True when the node is present.
   */
  has(index) {
    return this.nodes.has(index);
  }

  /**
   * Retrieve a node at the given index.
   * @param {number} index - Heap index to query.
   * @returns {{owner: string|null, createdAt: number, meta: object}|null} Node data or null if absent.
   */
  get(index) {
    return this.nodes.get(index) || null;
  }

  /**
   * Create or claim a node at the given index. Parent must exist unless index is 0.
   * @param {number} index - Heap index to create.
   * @param {{ owner?: string|null, createdAt?: number, meta?: object }} data - Node metadata.
   * @returns {{owner: string|null, createdAt: number, meta: object}} The stored node.
   * @throws {Error} When index is negative or parent is missing.
   */
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

  /**
   * Return sibling indices for a node. Optionally filters to existing nodes only.
   * @param {number} index - Heap index whose siblings to fetch.
   * @param {{ filterExisting?: boolean }} options - Filter flag.
   * @returns {number[]} Sibling indices.
   */
  getSiblings(index, { filterExisting = true } = {}) {
    const parent = getParentIndex(index);
    if (parent === null) return [];
    const sibs = getChildrenIndices(parent);
    if (filterExisting) return sibs.filter((i) => this.nodes.has(i));
    return sibs;
  }

  /**
   * Serialize the store to a compact payload.
   * @returns {Array<[number, { owner: string|null, createdAt: number, meta: object }]>} Entries payload.
   */
  toPayload() {
    return Array.from(this.nodes.entries());
  }

  /**
   * Rehydrate a store from a serialized payload.
   * @param {Array<[number, { owner: string|null, createdAt: number, meta: object }]>} payload - Serialized entries.
   * @returns {FractalStore} New store instance populated with entries.
   */
  static fromPayload(payload) {
    const store = new FractalStore();
    for (const [idx, node] of payload || []) {
      store.nodes.set(Number(idx), node);
    }
    return store;
  }
}
export {
  FractalStore,
  getParentIndex,
  getChildrenIndices,
  getDepth,
};
