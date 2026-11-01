import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import styles from './NotFoundPage.module.css';

type Props = {
  /** Where the way-out button goes: the site home by default, the portal home inside a portal. */
  home?: string;
  homeLabel?: string;
};

/** Unknown address or a record that no longer exists. Renders inside a shell, so no `<main>` of its own. */
export function NotFoundPage({ home = '/', homeLabel }: Props) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <EmptyState
        headingLevel={1}
        title={t('notFound.title')}
        description={t('notFound.body')}
        sport="football"
        action={
          <Button to={home} variant="secondary" icon="arrowLeft">
            {homeLabel ?? t('notFound.home')}
          </Button>
        }
      />
    </div>
  );
}
