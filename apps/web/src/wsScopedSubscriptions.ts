interface Subscription<Input, Event> {
  readonly input: Input;
  readonly listeners: Set<(event: Event) => void>;
}

export class WsScopedSubscriptions<Client, Input, Event> {
  private readonly entries = new Map<string, Subscription<Input, Event>>();

  constructor(
    private readonly source: {
      readonly key: (input: Input) => string;
      readonly getClient: () => Promise<Client>;
      readonly stop: (key: string) => Promise<void>;
      readonly start: (
        client: Client,
        key: string,
        input: Input,
        emit: (event: Event) => void,
        restart: () => void,
      ) => void;
    },
  ) {}

  private start(client: Client, key: string, subscription: Subscription<Input, Event>): void {
    if (this.entries.get(key) !== subscription) return;
    const restart = () => {
      if (this.entries.get(key) !== subscription) return;
      void this.source
        .getClient()
        .then((next) => this.start(next, key, subscription))
        .catch(() => undefined);
    };
    this.source.start(
      client,
      key,
      subscription.input,
      (event) => {
        for (const listener of subscription.listeners) {
          try {
            listener(event);
          } catch {
            // A failed listener must not block another surface's state update.
          }
        }
      },
      restart,
    );
  }

  subscribe(input: Input, listener: (event: Event) => void): () => void {
    const key = this.source.key(input);
    let subscription = this.entries.get(key);
    const isNew = subscription === undefined;
    if (!subscription) {
      subscription = { input, listeners: new Set() };
      this.entries.set(key, subscription);
    }
    subscription.listeners.add(listener);
    const selected = subscription;
    if (isNew)
      void this.source
        .getClient()
        .then((client) => this.start(client, key, selected))
        .catch(() => undefined);
    return () => {
      selected.listeners.delete(listener);
      if (selected.listeners.size > 0 || this.entries.get(key) !== selected) return;
      this.entries.delete(key);
      void this.source.stop(key);
    };
  }

  restart(client: Client): void {
    for (const [key, subscription] of this.entries) this.start(client, key, subscription);
  }

  dispose(): void {
    this.entries.clear();
  }
}
