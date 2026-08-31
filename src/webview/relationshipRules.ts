// Legal-relationship rules for nesting one element inside another
// (drag-and-drop containment), mirroring Archi's "Automatic Relationship
// Management" (see the User Guide's "Container Elements and Nested Element
// Relationships" section): dropping a child element onto a parent element
// offers to create whichever ArchiMate relationship types are legal between
// that specific pair, defaulting to the most sensible one.
//
// Archi ships a full legality matrix (Help | ArchiMate Relationships) but it
// isn't reproducible from the source PDF (only a cropped screenshot of it is
// embedded there). Instead this classifies every element type by its
// ArchiMate 3.2 "aspect" (active structure / behavior / passive structure /
// motivation / composite) and applies the spec's generic, layer-independent
// derivation rules — the same rules that make e.g. Application Component /
// Application Function behave just like Business Actor / Business Process.
// It intentionally favors precision over exhaustive recall: Association is
// always offered as a universal fallback, so an under-matched pair never
// blocks the user, it just falls back to the generic relationship.

import { ElementType, RelationshipType } from './model.js';

export type Aspect = 'active' | 'behavior' | 'passive' | 'motivation' | 'composite' | 'other';

const ASPECT: Record<ElementType, Aspect> = {
  // Motivation
  Stakeholder: 'motivation', Driver: 'motivation', Assessment: 'motivation',
  Goal: 'motivation', Outcome: 'motivation', Principle: 'motivation',
  Requirement: 'motivation', Constraint: 'motivation', Meaning: 'motivation', Value: 'motivation',
  // Strategy
  Resource: 'active', Capability: 'behavior', CourseOfAction: 'behavior', ValueStream: 'behavior',
  // Business
  BusinessActor: 'active', BusinessRole: 'active', BusinessCollaboration: 'active', BusinessInterface: 'active',
  BusinessProcess: 'behavior', BusinessFunction: 'behavior', BusinessInteraction: 'behavior', BusinessEvent: 'behavior', BusinessService: 'behavior',
  BusinessObject: 'passive', Contract: 'passive', Representation: 'passive',
  Product: 'composite',
  // Application
  ApplicationComponent: 'active', ApplicationCollaboration: 'active', ApplicationInterface: 'active',
  ApplicationFunction: 'behavior', ApplicationInteraction: 'behavior', ApplicationProcess: 'behavior', ApplicationEvent: 'behavior', ApplicationService: 'behavior',
  DataObject: 'passive',
  // Technology
  Node: 'active', Device: 'active', SystemSoftware: 'active', TechnologyCollaboration: 'active', TechnologyInterface: 'active', Path: 'active', CommunicationNetwork: 'active',
  TechnologyFunction: 'behavior', TechnologyProcess: 'behavior', TechnologyInteraction: 'behavior', TechnologyEvent: 'behavior', TechnologyService: 'behavior',
  Artifact: 'passive',
  // Physical
  Equipment: 'active', Facility: 'active', DistributionNetwork: 'active', Material: 'passive',
  // Implementation & Migration
  WorkPackage: 'behavior', Deliverable: 'passive', ImplementationEvent: 'behavior', Plateau: 'composite', Gap: 'other',
  // Other
  Grouping: 'composite', Location: 'composite', Junction: 'other',
};

export function aspectOf(type: ElementType): Aspect {
  return ASPECT[type];
}

/** Elements that can't meaningfully act as a container or a nested child. */
export function canNest(type: ElementType): boolean {
  return type !== 'Junction';
}

const isService = (type: ElementType): boolean => type.endsWith('Service');

// Legal relationship types with `a` as source and `b` as target.
function legalAsSourceTarget(a: ElementType, b: ElementType): RelationshipType[] {
  const aa = aspectOf(a), ab = aspectOf(b);
  const out: RelationshipType[] = [];
  if (aa === 'active' && (ab === 'behavior' || ab === 'active')) out.push('Assignment');
  if ((aa === ab && (aa === 'active' || aa === 'passive' || aa === 'behavior')) || aa === 'composite') {
    out.push('Composition', 'Aggregation');
  }
  if ((['active', 'behavior', 'passive'].includes(aa) && isService(b)) ||
      (aa === 'passive' && ab === 'passive') ||
      (aa === 'motivation' && ab === 'motivation')) {
    out.push('Realization');
  }
  if (aa === 'behavior' && ab === 'passive') out.push('Access');
  if (aa === 'behavior' && ab === 'behavior') out.push('Triggering', 'Flow');
  if (isService(b) && aa !== 'motivation') out.push('Serving');
  if (aa === 'motivation' || ab === 'motivation') out.push('Influence');
  if (a === b) out.push('Specialization');
  return out;
}

export interface NestingRelationOption {
  type: RelationshipType;
  /** 'forward' = parent is the relationship source, child is the target; 'reverse' = the other way round. */
  direction: 'forward' | 'reverse';
}

// Preference order used both to pick the pre-selected default and to sort
// the picker dialog's options (most specific/likely intent first).
const PRIORITY: RelationshipType[] = [
  'Assignment', 'Composition', 'Aggregation', 'Realization', 'Access',
  'Triggering', 'Flow', 'Serving', 'Influence', 'Specialization', 'Association',
];

/** Legal relationship options for nesting `childType` inside `parentType`, forward and reverse, deduped, most-likely first. Always includes Association once as a universal fallback. */
export function legalNestingRelationships(parentType: ElementType, childType: ElementType): NestingRelationOption[] {
  if (!canNest(parentType) || !canNest(childType)) return [];
  const seen = new Set<string>();
  const out: NestingRelationOption[] = [];
  const add = (type: RelationshipType, direction: 'forward' | 'reverse') => {
    const key = `${type}:${direction}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, direction });
  };
  for (const type of legalAsSourceTarget(parentType, childType)) add(type, 'forward');
  if (parentType !== childType) {
    for (const type of legalAsSourceTarget(childType, parentType)) add(type, 'reverse');
  }
  // Association has no real forward/reverse distinction for the user's
  // purposes here — offer it once, not twice.
  add('Association', 'forward');
  out.sort((x, y) => PRIORITY.indexOf(x.type) - PRIORITY.indexOf(y.type));
  return out;
}

/** The single best-guess relationship for this pair, or null if only the generic Association fallback applies (nothing more specific matched). */
export function defaultNestingRelationship(parentType: ElementType, childType: ElementType): NestingRelationOption | null {
  const options = legalNestingRelationships(parentType, childType);
  const specific = options.find(o => o.type !== 'Association');
  return specific || options[0] || null;
}
