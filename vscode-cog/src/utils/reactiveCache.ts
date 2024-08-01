import { CancellationToken, CancellationTokenSource } from 'vscode';

export class ReactiveCache {
    private dependencies = new Map<string, Set<string>>();
    private dependents = new Map<string, Set<string>>();
    private values = new Map<string, unknown>();

    private currentComputation: string | null = null;

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
        const outerComputation = this.currentComputation;
        this.currentComputation = key;
        try {
            console.log(`Computing ${key}`);
            return compute();
        } finally {
            this.currentComputation = outerComputation;
        }
    }

    delete(key: string) {
        if (!this.values.has(key)) {
            return;
        }
        console.log(`Deleting ${key}`);
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
