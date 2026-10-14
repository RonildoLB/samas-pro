import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { NodeStatus } from './esp.service';

const HIDDEN_NODES_STORAGE_KEY = 'samas_nodes_ocultos';

@Injectable({ providedIn: 'root' })
export class NodeVisibilityService {
  private readonly nodesSubject = new BehaviorSubject<NodeStatus[]>([]);
  readonly nodes$ = this.nodesSubject.asObservable();
  private readonly hiddenNodeIds = new Set<number>(this.loadHiddenNodeIds());

  setNodes(nodes: NodeStatus[]): void {
    this.nodesSubject.next(nodes);
  }

  isNodeVisible(nodeId: number): boolean {
    return !this.hiddenNodeIds.has(nodeId);
  }

  setNodeVisible(nodeId: number, visible: boolean): void {
    if (visible) {
      this.hiddenNodeIds.delete(nodeId);
    } else {
      this.hiddenNodeIds.add(nodeId);
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HIDDEN_NODES_STORAGE_KEY, JSON.stringify([...this.hiddenNodeIds]));
    }
  }

  private loadHiddenNodeIds(): number[] {
    if (typeof localStorage === 'undefined') return [];

    const stored = localStorage.getItem(HIDDEN_NODES_STORAGE_KEY);
    if (stored === null) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch (error) {
      console.error(`Não foi possível ler as preferências de nodes (${HIDDEN_NODES_STORAGE_KEY}).`, error);
      return [];
    }

    if (!Array.isArray(parsed) || !parsed.every(id => Number.isInteger(id))) {
      console.error(`As preferências de nodes em ${HIDDEN_NODES_STORAGE_KEY} têm um formato inválido.`);
      return [];
    }

    return parsed as number[];
  }
}
