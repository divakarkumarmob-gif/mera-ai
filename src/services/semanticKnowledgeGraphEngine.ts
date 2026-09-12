import { db } from "./firebaseAdmin";

export interface GraphNode {
  id: string;
  name: string;
  type: "person" | "project" | "preference" | "habit" | "channel" | "system" | "concept";
  attributes: Record<string, any>;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: string; // e.g. "created", "loves", "prefers", "manages", "bestfriend_of"
  weight: number;       // 1 to 100
  updatedAt: number;
}

const COLLECTION_NODES = "semantic_graph_nodes";
const COLLECTION_EDGES = "semantic_graph_edges";

class SemanticKnowledgeGraphEngine {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  private getDb() {
    return db;
  }

  public async init(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const [nodeSnap, edgeSnap] = await Promise.all([
          this.getDb().collection(COLLECTION_NODES).get(),
          this.getDb().collection(COLLECTION_EDGES).get(),
        ]);

        for (const doc of nodeSnap.docs) {
          this.nodes.set(doc.id, doc.data() as GraphNode);
        }
        for (const doc of edgeSnap.docs) {
          this.edges.set(doc.id, doc.data() as GraphEdge);
        }

        // Seed core knowledge graph nodes if empty
        if (this.nodes.size === 0) {
          this.seedInitialGraph();
        }

        this.isLoaded = true;
        console.log(`[KnowledgeGraph] Loaded ${this.nodes.size} nodes and ${this.edges.size} associative edges.`);
      } catch (e: any) {
        console.warn("[KnowledgeGraph] Firestore load warning:", e?.message || e);
        this.seedInitialGraph();
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  private seedInitialGraph() {
    const seedNodes: GraphNode[] = [
      { id: "boss_dk", name: "Divakar Kumar (Boss DK)", type: "person", attributes: { role: "Creator & Chief Architect" }, updatedAt: Date.now() },
      { id: "friday_ai", name: "Friday AI", type: "system", attributes: { role: "Super-intelligent AI Companion" }, updatedAt: Date.now() },
      { id: "mera_ai", name: "Mera-AI Platform", type: "project", attributes: { status: "Active Production" }, updatedAt: Date.now() },
      { id: "whatsapp_2", name: "WhatsApp 2 (Baileys Dedicated)", type: "channel", attributes: { priority: "Primary High-Speed Dispatch" }, updatedAt: Date.now() },
      { id: "telegram_bot", name: "Telegram Bot", type: "channel", attributes: { featureParity: "100%" }, updatedAt: Date.now() },
      { id: "pref_crisp", name: "Crisp Empathic Hinglish", type: "preference", attributes: { tone: "Warm, respectful, zero fluff" }, updatedAt: Date.now() },
    ];

    const seedEdges: GraphEdge[] = [
      { id: "e1", sourceNodeId: "boss_dk", targetNodeId: "friday_ai", relationship: "creator_of", weight: 100, updatedAt: Date.now() },
      { id: "e2", sourceNodeId: "friday_ai", targetNodeId: "boss_dk", relationship: "unconditionally_loyal_to", weight: 100, updatedAt: Date.now() },
      { id: "e3", sourceNodeId: "boss_dk", targetNodeId: "mera_ai", relationship: "architect_of", weight: 95, updatedAt: Date.now() },
      { id: "e4", sourceNodeId: "friday_ai", targetNodeId: "whatsapp_2", relationship: "dispatches_via", weight: 90, updatedAt: Date.now() },
      { id: "e5", sourceNodeId: "boss_dk", targetNodeId: "pref_crisp", relationship: "demands", weight: 95, updatedAt: Date.now() },
    ];

    for (const n of seedNodes) this.nodes.set(n.id, n);
    for (const e of seedEdges) this.edges.set(e.id, e);
  }

  /**
   * Adds or updates a node and relationship in the knowledge graph
   */
  public async addOrUpdateRelationship(
    sourceName: string,
    targetName: string,
    relation: string,
    options?: { sourceType?: GraphNode["type"]; targetType?: GraphNode["type"] }
  ): Promise<void> {
    await this.init();

    const srcId = sourceName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const tgtId = targetName.toLowerCase().replace(/[^a-z0-9]/g, "_");

    if (!this.nodes.has(srcId)) {
      const srcNode: GraphNode = { id: srcId, name: sourceName, type: options?.sourceType || "person", attributes: {}, updatedAt: Date.now() };
      this.nodes.set(srcId, srcNode);
      this.getDb().collection(COLLECTION_NODES).doc(srcId).set(srcNode).catch(() => {});
    }

    if (!this.nodes.has(tgtId)) {
      const tgtNode: GraphNode = { id: tgtId, name: targetName, type: options?.targetType || "concept", attributes: {}, updatedAt: Date.now() };
      this.nodes.set(tgtId, tgtNode);
      this.getDb().collection(COLLECTION_NODES).doc(tgtId).set(tgtNode).catch(() => {});
    }

    const edgeId = `${srcId}_${relation}_${tgtId}`;
    const edge: GraphEdge = {
      id: edgeId,
      sourceNodeId: srcId,
      targetNodeId: tgtId,
      relationship: relation,
      weight: 90,
      updatedAt: Date.now(),
    };
    this.edges.set(edgeId, edge);
    this.getDb().collection(COLLECTION_EDGES).doc(edgeId).set(edge).catch(() => {});
  }

  /**
   * Compiles the Knowledge Graph mind-map into prompt format
   */
  public async compileKnowledgeGraphPrompt(): Promise<string> {
    await this.init();
    if (this.edges.size === 0) return "";

    const edgesList = Array.from(this.edges.values()).slice(0, 10);
    const graphLines = edgesList.map((e) => {
      const src = this.nodes.get(e.sourceNodeId)?.name || e.sourceNodeId;
      const tgt = this.nodes.get(e.targetNodeId)?.name || e.targetNodeId;
      return `• [${src}] ➔ (${e.relationship}) ➔ [${tgt}]`;
    });

    return `\n🕸️ SEMANTIC KNOWLEDGE GRAPH (DeepMind/Anthropic Interconnected Mind-Map):\n` +
      graphLines.join("\n") +
      "\n";
  }
}

export const semanticKnowledgeGraphEngine = new SemanticKnowledgeGraphEngine();
