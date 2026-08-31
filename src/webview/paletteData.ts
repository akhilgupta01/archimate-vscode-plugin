// Shared between the main designer (embedded palette, used by the
// standalone dev-preview harness) and the standalone palette sidebar
// webview (src/webview/paletteMain.ts, used inside the real VS Code
// extension) so both list the exact same tools in the exact same order.

import { ElementType, RelationshipType, LayerKey, RELATIONSHIP_TYPES } from './model.js';

export function humanize(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export const PALETTE_GROUPS: { layer: LayerKey; types: ElementType[] }[] = [
  { layer: 'strategy', types: ['Resource', 'Capability', 'CourseOfAction', 'ValueStream'] },
  { layer: 'business', types: ['BusinessActor', 'BusinessRole', 'BusinessCollaboration', 'BusinessInterface', 'BusinessProcess', 'BusinessFunction', 'BusinessInteraction', 'BusinessEvent', 'BusinessService', 'BusinessObject', 'Contract', 'Representation', 'Product'] },
  { layer: 'application', types: ['ApplicationComponent', 'ApplicationCollaboration', 'ApplicationInterface', 'ApplicationFunction', 'ApplicationInteraction', 'ApplicationProcess', 'ApplicationEvent', 'ApplicationService', 'DataObject'] },
  { layer: 'technology', types: ['Node', 'Device', 'SystemSoftware', 'TechnologyCollaboration', 'TechnologyInterface', 'Path', 'CommunicationNetwork', 'TechnologyFunction', 'TechnologyProcess', 'TechnologyInteraction', 'TechnologyEvent', 'TechnologyService', 'Artifact', 'Equipment', 'Facility', 'DistributionNetwork', 'Material'] },
  { layer: 'motivation', types: ['Stakeholder', 'Driver', 'Assessment', 'Goal', 'Outcome', 'Principle', 'Requirement', 'Constraint', 'Meaning', 'Value'] },
  { layer: 'implementation', types: ['WorkPackage', 'Deliverable', 'ImplementationEvent', 'Plateau', 'Gap'] },
  { layer: 'other', types: ['Grouping', 'Location', 'Junction'] },
];

export const RELATIONSHIP_LIST = Object.keys(RELATIONSHIP_TYPES) as RelationshipType[];
