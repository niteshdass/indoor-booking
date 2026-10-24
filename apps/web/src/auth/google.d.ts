export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: { client_id: string; callback(response: { credential: string }): void }): void;
          renderButton(
            parent: HTMLElement,
            options: { theme: 'outline' | 'filled_black'; size: 'large'; text: 'continue_with'; locale: string },
          ): void;
        };
      };
    };
  }
}
