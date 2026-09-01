// ArchiMate 3.2 type catalogue: layers, element types, relationship types.
// Colors follow the standard ArchiMate notation palette.

export type LayerKey =
  | 'motivation' | 'strategy' | 'business' | 'application'
  | 'technology' | 'physical' | 'implementation' | 'other';

export interface Layer {
  label: string;
  color: string;
  stroke: string;
}

export const LAYERS: Record<LayerKey, Layer> = {
  motivation: { label: 'Motivation', color: '#E8E0F5', stroke: '#8B7BB8' },
  strategy: { label: 'Strategy', color: '#F5DEAA', stroke: '#C9A227' },
  business: { label: 'Business', color: '#FFFFB5', stroke: '#C9C24C' },
  application: { label: 'Application', color: '#B5FFFF', stroke: '#3FA9A9' },
  technology: { label: 'Technology', color: '#C9E7B7', stroke: '#5E9C4C' },
  physical: { label: 'Physical', color: '#C9E7B7', stroke: '#5E9C4C' },
  implementation: { label: 'Implementation & Migration', color: '#FFE0E0', stroke: '#C97A7A' },
  other: { label: 'Other', color: '#E5E5E5', stroke: '#999999' },
};

export type ElementShape = 'rect' | 'rounded' | 'oval' | 'component' | 'box3d' | 'chevron' | 'wavyrect' | 'junction';

export interface ElementTypeDef {
  layer: LayerKey;
  shape: ElementShape;
  badge: string | null;
  isContainer?: boolean;
}

export const ELEMENT_TYPES = {
  // Motivation
  Stakeholder: { layer: 'motivation', shape: 'rounded', badge: 'stakeholder' },
  Driver: { layer: 'motivation', shape: 'rounded', badge: 'driver' },
  Assessment: { layer: 'motivation', shape: 'rounded', badge: 'assessment' },
  Goal: { layer: 'motivation', shape: 'oval', badge: 'goal' },
  Outcome: { layer: 'motivation', shape: 'rounded', badge: 'outcome' },
  Principle: { layer: 'motivation', shape: 'rounded', badge: 'principle' },
  Requirement: { layer: 'motivation', shape: 'rounded', badge: 'requirement' },
  Constraint: { layer: 'motivation', shape: 'rounded', badge: 'constraint' },
  Meaning: { layer: 'motivation', shape: 'rounded', badge: 'meaning' },
  Value: { layer: 'motivation', shape: 'rounded', badge: 'value' },
  // Strategy
  Resource: { layer: 'strategy', shape: 'rect', badge: 'resource' },
  Capability: { layer: 'strategy', shape: 'rounded', badge: 'capability' },
  CourseOfAction: { layer: 'strategy', shape: 'rounded', badge: 'course' },
  ValueStream: { layer: 'strategy', shape: 'chevron', badge: 'valuestream' },
  // Business
  BusinessActor: { layer: 'business', shape: 'rect', badge: 'actor' },
  BusinessRole: { layer: 'business', shape: 'rect', badge: 'role' },
  BusinessCollaboration: { layer: 'business', shape: 'rect', badge: 'collaboration' },
  BusinessInterface: { layer: 'business', shape: 'rect', badge: 'interface' },
  BusinessProcess: { layer: 'business', shape: 'rect', badge: 'process' },
  BusinessFunction: { layer: 'business', shape: 'rect', badge: 'function' },
  BusinessInteraction: { layer: 'business', shape: 'rect', badge: 'interaction' },
  BusinessEvent: { layer: 'business', shape: 'rect', badge: 'event' },
  BusinessService: { layer: 'business', shape: 'rounded', badge: 'service' },
  BusinessObject: { layer: 'business', shape: 'rect', badge: 'object' },
  Contract: { layer: 'business', shape: 'rect', badge: 'contract' },
  Representation: { layer: 'business', shape: 'wavyrect', badge: 'representation' },
  Product: { layer: 'business', shape: 'rect', badge: 'product' },
  // Application
  ApplicationComponent: { layer: 'application', shape: 'component', badge: 'component' },
  ApplicationCollaboration: { layer: 'application', shape: 'rect', badge: 'collaboration' },
  ApplicationInterface: { layer: 'application', shape: 'rect', badge: 'interface' },
  ApplicationFunction: { layer: 'application', shape: 'rect', badge: 'function' },
  ApplicationInteraction: { layer: 'application', shape: 'rect', badge: 'interaction' },
  ApplicationProcess: { layer: 'application', shape: 'rect', badge: 'process' },
  ApplicationEvent: { layer: 'application', shape: 'rect', badge: 'event' },
  ApplicationService: { layer: 'application', shape: 'rounded', badge: 'service' },
  DataObject: { layer: 'application', shape: 'rect', badge: 'object' },
  // Technology
  Node: { layer: 'technology', shape: 'box3d', badge: 'node' },
  Device: { layer: 'technology', shape: 'box3d', badge: 'device' },
  SystemSoftware: { layer: 'technology', shape: 'box3d', badge: 'system' },
  TechnologyCollaboration: { layer: 'technology', shape: 'rect', badge: 'collaboration' },
  TechnologyInterface: { layer: 'technology', shape: 'rect', badge: 'interface' },
  Path: { layer: 'technology', shape: 'rect', badge: 'path' },
  CommunicationNetwork: { layer: 'technology', shape: 'rect', badge: 'network' },
  TechnologyFunction: { layer: 'technology', shape: 'rect', badge: 'function' },
  TechnologyProcess: { layer: 'technology', shape: 'rect', badge: 'process' },
  TechnologyInteraction: { layer: 'technology', shape: 'rect', badge: 'interaction' },
  TechnologyEvent: { layer: 'technology', shape: 'rect', badge: 'event' },
  TechnologyService: { layer: 'technology', shape: 'rounded', badge: 'service' },
  Artifact: { layer: 'technology', shape: 'rect', badge: 'artifact' },
  // Physical
  Equipment: { layer: 'physical', shape: 'box3d', badge: 'equipment' },
  Facility: { layer: 'physical', shape: 'box3d', badge: 'facility' },
  DistributionNetwork: { layer: 'physical', shape: 'rect', badge: 'network' },
  Material: { layer: 'physical', shape: 'rect', badge: 'material' },
  // Implementation & Migration
  WorkPackage: { layer: 'implementation', shape: 'rect', badge: 'workpackage' },
  Deliverable: { layer: 'implementation', shape: 'rect', badge: 'deliverable' },
  ImplementationEvent: { layer: 'implementation', shape: 'rect', badge: 'event' },
  Plateau: { layer: 'implementation', shape: 'rect', badge: 'plateau' },
  Gap: { layer: 'implementation', shape: 'rounded', badge: 'gap' },
  // Other / composite
  Grouping: { layer: 'other', shape: 'rect', badge: 'grouping', isContainer: true },
  Location: { layer: 'other', shape: 'rect', badge: 'location', isContainer: true },
  Junction: { layer: 'other', shape: 'junction', badge: null },
} satisfies Record<string, ElementTypeDef>;

export type ElementType = keyof typeof ELEMENT_TYPES;

export type RelationshipStyle = 'solid' | 'dashed' | 'dotted';
export type MarkerKind =
  | 'diamond-filled' | 'diamond-hollow' | 'dot-filled'
  | 'arrow-open' | 'arrow-hollow' | 'arrow-line' | 'arrow-line-small' | 'arrow-filled';

export interface RelationshipTypeDef {
  style: RelationshipStyle;
  startMarker: MarkerKind | null;
  endMarker: MarkerKind | null;
}

export const RELATIONSHIP_TYPES = {
  Composition: { style: 'solid', startMarker: 'diamond-filled', endMarker: null },
  Aggregation: { style: 'solid', startMarker: 'diamond-hollow', endMarker: null },
  Assignment: { style: 'solid', startMarker: 'dot-filled', endMarker: 'arrow-open' },
  Realization: { style: 'dashed', startMarker: null, endMarker: 'arrow-hollow' },
  Serving: { style: 'solid', startMarker: null, endMarker: 'arrow-line' },
  Access: { style: 'dotted', startMarker: null, endMarker: 'arrow-line-small' },
  Influence: { style: 'dashed', startMarker: null, endMarker: 'arrow-line' },
  Triggering: { style: 'solid', startMarker: null, endMarker: 'arrow-filled' },
  Flow: { style: 'dashed', startMarker: null, endMarker: 'arrow-filled' },
  Specialization: { style: 'solid', startMarker: null, endMarker: 'arrow-hollow' },
  Association: { style: 'solid', startMarker: null, endMarker: null },
} satisfies Record<string, RelationshipTypeDef>;

export type RelationshipType = keyof typeof RELATIONSHIP_TYPES;

export type LineWidth = 'thin' | 'normal' | 'thick';
export const LINE_WIDTH_PX: Record<LineWidth, number> = { thin: 1, normal: 1.5, thick: 3 };

export interface Bounds { x: number; y: number; w: number; h: number; }
export interface Point { x: number; y: number; }
export interface Port { side: 'n' | 's' | 'e' | 'w'; t: number; }

let _idCounter = 1;
export function nextId(prefix = 'el'): string {
  return `${prefix}-${Date.now().toString(36)}-${(_idCounter++).toString(36)}`;
}

export interface ArchimateElementProps {
  id?: string;
  type: ElementType;
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  documentation?: string;
  /** id of the element this one is nested inside (visual containment), or null/undefined if top-level. */
  parentId?: string | null;
  // Appearance overrides — unset (null/undefined) means "use the layer
  // default", same convention Archi uses for its Appearance tab.
  fillColor?: string | null;
  /** 0-255, matching Archi's own alpha convention (not the 0-1 SVG scale). */
  fillOpacity?: number | null;
  lineColor?: string | null;
  /** 0-255, matching Archi's own alpha convention (not the 0-1 SVG scale). */
  lineOpacity?: number | null;
  lineWidth?: LineWidth | null;
  lineStyle?: RelationshipStyle | null;
  iconColor?: string | null;
  fontColor?: string | null;
  fontFamily?: string | null;
  fontSize?: number | null;
}

export class ArchimateElement {
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  documentation: string;
  parentId: string | null;
  fillColor: string | null;
  fillOpacity: number | null;
  lineColor: string | null;
  lineOpacity: number | null;
  lineWidth: LineWidth | null;
  lineStyle: RelationshipStyle | null;
  iconColor: string | null;
  fontColor: string | null;
  fontFamily: string | null;
  fontSize: number | null;

  constructor({
    id, type, name, x = 0, y = 0, w = 140, h = 55, documentation = '', parentId = null,
    fillColor = null, fillOpacity = null, lineColor = null, lineOpacity = null,
    lineWidth = null, lineStyle = null, iconColor = null, fontColor = null, fontFamily = null, fontSize = null,
  }: ArchimateElementProps) {
    if (!ELEMENT_TYPES[type]) throw new Error(`Unknown ArchiMate element type: ${type}`);
    this.id = id || nextId('elem');
    this.type = type;
    this.name = name || type;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.documentation = documentation;
    this.parentId = parentId ?? null;
    this.fillColor = fillColor ?? null;
    this.fillOpacity = fillOpacity ?? null;
    this.lineColor = lineColor ?? null;
    this.lineOpacity = lineOpacity ?? null;
    this.lineWidth = lineWidth ?? null;
    this.lineStyle = lineStyle ?? null;
    this.iconColor = iconColor ?? null;
    this.fontColor = fontColor ?? null;
    this.fontFamily = fontFamily ?? null;
    this.fontSize = fontSize ?? null;
  }
  get layer(): LayerKey { return ELEMENT_TYPES[this.type].layer as LayerKey; }
  bounds(): Bounds { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

/** Just the Appearance-tab fields of an element — e.g. what the canvas's Format Painter tool copies from one element and stamps onto another. */
export interface AppearanceSnapshot {
  fillColor: string | null;
  fillOpacity: number | null;
  lineColor: string | null;
  lineOpacity: number | null;
  lineWidth: LineWidth | null;
  lineStyle: RelationshipStyle | null;
  iconColor: string | null;
  fontColor: string | null;
  fontFamily: string | null;
  fontSize: number | null;
}
export function captureAppearance(el: ArchimateElement): AppearanceSnapshot {
  return {
    fillColor: el.fillColor, fillOpacity: el.fillOpacity,
    lineColor: el.lineColor, lineOpacity: el.lineOpacity,
    lineWidth: el.lineWidth, lineStyle: el.lineStyle,
    iconColor: el.iconColor,
    fontColor: el.fontColor, fontFamily: el.fontFamily, fontSize: el.fontSize,
  };
}
export function applyAppearance(el: ArchimateElement, snap: AppearanceSnapshot): void {
  el.fillColor = snap.fillColor; el.fillOpacity = snap.fillOpacity;
  el.lineColor = snap.lineColor; el.lineOpacity = snap.lineOpacity;
  el.lineWidth = snap.lineWidth; el.lineStyle = snap.lineStyle;
  el.iconColor = snap.iconColor;
  el.fontColor = snap.fontColor; el.fontFamily = snap.fontFamily; el.fontSize = snap.fontSize;
}

export interface ArchimateRelationshipProps {
  id?: string;
  type: RelationshipType;
  source: string;
  target: string;
  name?: string;
  bendpoints?: Point[] | null;
  sourcePort?: Port | null;
  targetPort?: Port | null;
}

export class ArchimateRelationship {
  id: string;
  type: RelationshipType;
  source: string;
  target: string;
  name: string;
  bendpoints: Point[] | null;
  sourcePort: Port | null;
  targetPort: Port | null;

  constructor({ id, type, source, target, name = '', bendpoints = null, sourcePort = null, targetPort = null }: ArchimateRelationshipProps) {
    if (!RELATIONSHIP_TYPES[type]) throw new Error(`Unknown ArchiMate relationship type: ${type}`);
    this.id = id || nextId('rel');
    this.type = type;
    this.source = source; // element id
    this.target = target; // element id
    this.name = name;
    // user-overridden route - null means auto-route
    this.bendpoints = bendpoints;
    // user-dragged hinge point on the source/target element's boundary;
    // null means let the router pick
    this.sourcePort = sourcePort;
    this.targetPort = targetPort;
  }
}

export interface ModelJSON {
  elements: ArchimateElementProps[];
  relationships: ArchimateRelationshipProps[];
}

export class ArchimateModel {
  elements: Map<string, ArchimateElement> = new Map();
  relationships: Map<string, ArchimateRelationship> = new Map();

  addElement(props: ArchimateElementProps | ArchimateElement): ArchimateElement {
    const el = props instanceof ArchimateElement ? props : new ArchimateElement(props);
    this.elements.set(el.id, el);
    return el;
  }
  addRelationship(props: ArchimateRelationshipProps | ArchimateRelationship): ArchimateRelationship {
    const rel = props instanceof ArchimateRelationship ? props : new ArchimateRelationship(props);
    this.relationships.set(rel.id, rel);
    return rel;
  }
  removeElement(id: string): void {
    this.elements.delete(id);
    for (const [rid, rel] of this.relationships) {
      if (rel.source === id || rel.target === id) this.relationships.delete(rid);
    }
    // Nesting is a view-level convenience, not itself a semantic relationship,
    // so removing a container just releases its children back to top level
    // instead of deleting them too.
    for (const child of this.elements.values()) {
      if (child.parentId === id) child.parentId = null;
    }
  }
  removeRelationship(id: string): void { this.relationships.delete(id); }
  getElement(id: string): ArchimateElement | undefined { return this.elements.get(id); }
  getChildren(parentId: string): ArchimateElement[] {
    return [...this.elements.values()].filter(e => e.parentId === parentId);
  }
  /** True if `id` is nested (directly or transitively) inside `ancestorId`. */
  isDescendantOf(id: string, ancestorId: string): boolean {
    const seen = new Set<string>();
    let cur = this.elements.get(id)?.parentId ?? null;
    while (cur && !seen.has(cur)) {
      if (cur === ancestorId) return true;
      seen.add(cur);
      cur = this.elements.get(cur)?.parentId ?? null;
    }
    return false;
  }

  toJSON(): ModelJSON {
    return {
      elements: [...this.elements.values()].map(e => ({ ...e })),
      relationships: [...this.relationships.values()].map(r => ({ ...r })),
    };
  }
  static fromJSON(json: ModelJSON): ArchimateModel {
    const m = new ArchimateModel();
    for (const e of json.elements || []) m.addElement(new ArchimateElement(e));
    for (const r of json.relationships || []) m.addRelationship(new ArchimateRelationship(r));
    return m;
  }
}
