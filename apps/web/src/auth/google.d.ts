export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: { client_id: string; callback(response: { credential: string }): void }): void;
          renderButton(
            parent: HTMLElement,
            options: {
              theme: 'outline' | 'filled_blue' | 'filled_black';
              size: 'large';
              shape: 'rectangular' | 'pill';
              text: 'signin_with' | 'signup_with' | 'continue_with';
              locale: string;
              width?: number;
            },
          ): void;
        };
      };
    };
  }
}
