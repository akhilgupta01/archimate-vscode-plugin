import { describe, it, expect } from 'vitest';
import { ArchimateElement, ArchimateRelationship, ArchimateModel } from './model.js';

describe('ArchimateElement', () => {
  it('applies defaults', () => {
    const e = new ArchimateElement({ type: 'BusinessActor' });
    expect(e.id).toBeTruthy();
    expect(e.name).toBe('BusinessActor');
    expect(e.x).toBe(0);
    expect(e.y).toBe(0);
    expect(e.w).toBe(140);
    expect(e.h).toBe(55);
    expect(e.documentation).toBe('');
    expect(e.parentId).toBeNull();
    expect(e.layer).toBe('business');
  });

  it('throws on an unknown element type', () => {
    // @ts-expect-error deliberately invalid type
    expect(() => new ArchimateElement({ type: 'NotARealType' })).toThrow(/Unknown ArchiMate element type/);
  });
});

describe('ArchimateRelationship', () => {
  it('throws on an unknown relationship type', () => {
    // @ts-expect-error deliberately invalid type
    expect(() => new ArchimateRelationship({ type: 'NotARealRel', source: 'a', target: 'b' })).toThrow(/Unknown ArchiMate relationship type/);
  });
});

describe('ArchimateModel', () => {
  it('removeElement cascades relationship removal', () => {
    const m = new ArchimateModel();
    const a = m.addElement({ type: 'BusinessActor' });
    const b = m.addElement({ type: 'BusinessActor' });
    const rel = m.addRelationship({ type: 'Serving', source: a.id, target: b.id });

    m.removeElement(a.id);

    expect(m.getElement(a.id)).toBeUndefined();
    expect(m.relationships.get(rel.id)).toBeUndefined();
  });

  it('removeElement releases children back to top level instead of deleting them', () => {
    const m = new ArchimateModel();
    const container = m.addElement({ type: 'Grouping' });
    const child = m.addElement({ type: 'BusinessActor', parentId: container.id });

    m.removeElement(container.id);

    expect(m.getElement(child.id)).toBeDefined();
    expect(m.getElement(child.id)!.parentId).toBeNull();
  });

  it('getChildren returns only direct children', () => {
    const m = new ArchimateModel();
    const parent = m.addElement({ type: 'Grouping' });
    const child1 = m.addElement({ type: 'BusinessActor', parentId: parent.id });
    const child2 = m.addElement({ type: 'BusinessActor', parentId: parent.id });
    const grandchild = m.addElement({ type: 'BusinessActor', parentId: child1.id });
    m.addElement({ type: 'BusinessActor' }); // unrelated top-level element

    const children = m.getChildren(parent.id).map(e => e.id).sort();
    expect(children).toEqual([child1.id, child2.id].sort());
    expect(children).not.toContain(grandchild.id);
  });

  it('isDescendantOf finds direct and transitive nesting', () => {
    const m = new ArchimateModel();
    const grandparent = m.addElement({ type: 'Grouping' });
    const parent = m.addElement({ type: 'Grouping', parentId: grandparent.id });
    const child = m.addElement({ type: 'BusinessActor', parentId: parent.id });
    const stranger = m.addElement({ type: 'BusinessActor' });

    expect(m.isDescendantOf(parent.id, grandparent.id)).toBe(true);
    expect(m.isDescendantOf(child.id, grandparent.id)).toBe(true); // transitive
    expect(m.isDescendantOf(child.id, parent.id)).toBe(true);
    expect(m.isDescendantOf(stranger.id, grandparent.id)).toBe(false);
    expect(m.isDescendantOf(grandparent.id, child.id)).toBe(false); // wrong direction
  });

  it('isDescendantOf terminates on a cycle instead of looping forever', () => {
    const m = new ArchimateModel();
    const a = m.addElement({ type: 'Grouping' });
    const b = m.addElement({ type: 'Grouping', parentId: a.id });
    // Manually fabricate a cycle that shouldn't occur in practice, to prove
    // the `seen`-guarded walk in isDescendantOf terminates instead of hanging.
    a.parentId = b.id;

    expect(() => m.isDescendantOf(a.id, 'nonexistent')).not.toThrow();
    expect(m.isDescendantOf(a.id, 'nonexistent')).toBe(false);
  });

  it('round-trips through toJSON/fromJSON', () => {
    const m = new ArchimateModel();
    const a = m.addElement({ type: 'ApplicationComponent', name: 'Order Service', x: 10, y: 20 });
    const b = m.addElement({ type: 'ApplicationComponent', name: 'Payment Service', parentId: a.id });
    m.addRelationship({ type: 'Serving', source: a.id, target: b.id, name: 'calls' });

    const json = m.toJSON();
    const restored = ArchimateModel.fromJSON(json);

    expect(restored.elements.size).toBe(2);
    expect(restored.relationships.size).toBe(1);
    const restoredA = [...restored.elements.values()].find(e => e.name === 'Order Service')!;
    const restoredB = [...restored.elements.values()].find(e => e.name === 'Payment Service')!;
    expect(restoredA.x).toBe(10);
    expect(restoredA.y).toBe(20);
    expect(restoredB.parentId).toBe(restoredA.id);
    expect([...restored.relationships.values()][0].name).toBe('calls');
  });
});
