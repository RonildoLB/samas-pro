import { NodeVisibilityService } from './node-visibility.service';
import { NodeStatus } from './esp.service';

describe('NodeVisibilityService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps nodes visible by default and persists visibility changes', () => {
    const service = new NodeVisibilityService();

    expect(service.isNodeVisible(12)).toBe(true);

    service.setNodeVisible(12, false);
    expect(service.isNodeVisible(12)).toBe(false);
    expect(localStorage.getItem('samas_nodes_ocultos')).toBe('[12]');

    service.setNodeVisible(12, true);
    expect(service.isNodeVisible(12)).toBe(true);
    expect(localStorage.getItem('samas_nodes_ocultos')).toBe('[]');
  });

  it('publishes the latest node list for the menu', () => {
    const service = new NodeVisibilityService();
    const nodes: NodeStatus[] = [{
      name_valve: 'Horta',
      ID_valve: 12,
      estado_canal_1: 0,
      estado_canal_2: 0,
      clock_updated: false,
      clock: '',
      schedulings: [],
    }];
    let publishedNodes: NodeStatus[] = [];

    service.nodes$.subscribe(value => publishedNodes = value);
    service.setNodes(nodes);

    expect(publishedNodes).toEqual(nodes);
  });
});
