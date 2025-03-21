import { log } from '../log';

export class ReactiveCache {
    private dependencies = new Map<string, Set<string>>();
    private dependents = new Map<string, Set<string>>();
    private values = new Map<string, unknown>();

    private currentComputations: string[] = [];

    private get currentComputation() {
        return this.currentComputations[this.currentComputations.length - 1];
    }

    compute<T>(key: string, compute: () => T): T {
        if (this.values.has(key)) {
            const value = this.values.get(key);
            this.track(key);
            return value as T;
        }

        const value: T = this.inScope(key, compute);

        this.values.set(key, value);
        this.track(key);
        return value;
    }

    private track(key: string) {
        if (this.currentComputation) {
            addNode(this.dependencies, this.currentComputation, key);
            addNode(this.dependents, key, this.currentComputation);
        }
    }

    inScope<T>(key: string, compute: () => T) {
        if (this.currentComputations.includes(key)) {
            const cycleStart = this.currentComputations.indexOf(key);
            const cyclePath = [...this.currentComputations.slice(cycleStart), key].join(' -> ');
            throw new Error(`Cyclic dependency detected: ${cyclePath}`);
        }
        this.currentComputations.push(key);
        try {
            log.log(`Computing ${key}`);
            return compute();
        } finally {
            this.currentComputations.pop();
        }
    }

    delete(key: string) {
        if (!this.values.has(key)) {
            return;
        }
        log.log(`Invalidating ${key}`);
        for (const dep of this.dependents.get(key) ?? []) {
            this.delete(dep);
        }
        this.dependencies.delete(key);
        this.dependents.delete(key);
        this.values.delete(key);
    }
}

function addNode(map: Map<string, Set<string>>, key: string, value: string) {
    let set = map.get(key);
    if (!set) {
        set = new Set();
        map.set(key, set);
    }
    set.add(value);
}
