import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import styles from './ErrorBoundary.module.css';

/** What a crashed page shows instead of a blank screen: a short apology and Reload. */
function CrashPanel() {
  const { t } = useTranslation();
  return (
    <main className={styles.page} role="alert">
      <EmptyState
        title={t('crash.title')}
        description={t('crash.body')}
        sport="padel"
        action={
          <div className={styles.actions}>
            <Button icon="refresh" onClick={() => window.location.reload()}>
              {t('crash.reload')}
            </Button>
            <Button variant="secondary" onClick={() => window.location.assign('/')}>
              {t('crash.home')}
            </Button>
          </div>
        }
      />
    </main>
  );
}

type Props = { resetKey: string; children: ReactNode };
type State = { failed: boolean };

class Boundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Moving to another page gives it a fresh try.
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? <CrashPanel /> : this.props.children;
  }
}

/** Catches render errors anywhere below it; clears itself when the user goes to another page. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
