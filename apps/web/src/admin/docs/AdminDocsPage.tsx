import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LanguageMenu } from '../../components/LanguageSwitcher';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { ThemeMenu } from '../../theme/ThemeToggle';
import { GROUP_ORDER, docsEn, type Block, type Docs, type DocTopic } from './content';
import { docsRu } from './content.ru';
import styles from './AdminDocs.module.css';

const BY_LANGUAGE: Record<string, Docs> = { en: docsEn, ru: docsRu };

/** `code` in backticks and [label](https://…) links; everything else is plain text. */
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      m[1] !== undefined ? (
        <code key={m.index} className={styles.inlineCode}>
          {m[1]}
        </code>
      ) : (
        <a key={m.index} href={m[3]} target="_blank" rel="noreferrer">
          {m[2]}
        </a>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function BlockView({ block }: { block: Block }) {
  if ('p' in block) return <p>{inline(block.p)}</p>;
  if ('steps' in block)
    return (
      <ol className={styles.steps}>
        {block.steps.map((s) => (
          <li key={s}>{inline(s)}</li>
        ))}
      </ol>
    );
  if ('list' in block)
    return (
      <ul className={styles.list}>
        {block.list.map((s) => (
          <li key={s}>{inline(s)}</li>
        ))}
      </ul>
    );
  if ('code' in block)
    return (
      <pre className={styles.code}>
        <code>{block.code}</code>
      </pre>
    );
  if ('table' in block)
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {block.table.head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i}>{inline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <Alert tone={block.tone} className={styles.note}>
      {inline(block.note)}
    </Alert>
  );
}

function TopicNav({ docs, label }: { docs: Docs; label: string }) {
  return (
    <nav aria-label={label} className={styles.nav}>
      {GROUP_ORDER.map((g) => (
        <div key={g} className={styles.navGroup}>
          <p className={styles.navLabel}>{docs.groups[g]}</p>
          {docs.topics
            .filter((tp) => tp.group === g)
            .map((tp) => (
              <NavLink key={tp.id} to={`/admin/docs/${tp.id}`} className={({ isActive }) => [styles.navLink, isActive && styles.active].filter(Boolean).join(' ')}>
                {tp.title}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  );
}

function Pager({ prev, next }: { prev?: DocTopic; next?: DocTopic }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('admin.docs.pager')} className={styles.pager}>
      {prev && (
        <Link to={`/admin/docs/${prev.id}`} className={styles.pagerLink}>
          <span className={styles.pagerHint}>{t('admin.docs.previous')}</span>
          <span className={styles.pagerTitle}>
            <Icon name="arrowLeft" />
            {prev.title}
          </span>
        </Link>
      )}
      {next && (
        <Link to={`/admin/docs/${next.id}`} className={[styles.pagerLink, styles.pagerNext].join(' ')}>
          <span className={styles.pagerHint}>{t('admin.docs.next')}</span>
          <span className={styles.pagerTitle}>
            {next.title}
            <Icon name="arrowRight" />
          </span>
        </Link>
      )}
    </nav>
  );
}

/** `/admin/docs/:topic`: the admin guide, a standalone page with its own header and topic sidebar (opened in a new tab). */
export function AdminDocsPage() {
  const { t, i18n } = useTranslation();
  const { topic: topicId } = useParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const docs = BY_LANGUAGE[(i18n.resolvedLanguage ?? i18n.language).slice(0, 2)] ?? docsEn;
  const order = GROUP_ORDER.flatMap((g) => docs.topics.filter((tp) => tp.group === g));
  const index = order.findIndex((tp) => tp.id === topicId);
  const topic = order[index];

  useEffect(() => {
    setMenuOpen(false);
    if (!window.location.hash) window.scrollTo?.(0, 0);
  }, [topicId]);

  useEffect(() => {
    if (topic) document.title = `${topic.title} · ${t('admin.docs.title')}`;
  }, [topic, t]);

  if (!topic) return <Navigate to="/admin/docs/overview" replace />;

  return (
    <div className={styles.docs}>
      <a href="#docs-article" className={styles.skip}>
        {t('admin.docs.skip')}
      </a>
      <header className={styles.header}>
        <Link to="/admin/docs/overview" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <Icon name="book" />
          </span>
          <span className={styles.brandText}>{t('admin.docs.title')}</span>
        </Link>
        <div className={styles.tools}>
          <Button variant="ghost" size="sm" icon="note" className={styles.topicsButton} onClick={() => setMenuOpen(true)}>
            {t('admin.docs.topics')}
          </Button>
          <LanguageMenu />
          <ThemeMenu />
          <Link to="/admin" className={styles.back}>
            <Icon name="arrowLeft" />
            <span className={styles.backText}>{t('admin.docs.backToAdmin')}</span>
          </Link>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <TopicNav docs={docs} label={t('admin.docs.topics')} />
        </aside>

        <main id="docs-article" className={styles.article}>
          <p className={styles.eyebrow}>{docs.groups[topic.group]}</p>
          <h1 className={styles.title}>{topic.title}</h1>
          <p className={styles.summary}>{topic.summary}</p>
          {topic.settings && (
            <Button variant="secondary" size="sm" icon="sliders" to={`/admin/settings?section=${topic.settings}`}>
              {t('admin.docs.openSettings')}
            </Button>
          )}
          {topic.sections.map((sec) => (
            <section key={sec.id} aria-labelledby={sec.id} className={styles.section}>
              <h2 id={sec.id} className={styles.h2}>
                <a href={`#${sec.id}`} className={styles.anchor}>
                  {sec.title}
                </a>
              </h2>
              {sec.blocks.map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </section>
          ))}
          <Pager prev={order[index - 1]} next={order[index + 1]} />
        </main>

        <aside className={styles.toc}>
          <p className={styles.navLabel}>{t('admin.docs.onThisPage')}</p>
          <nav aria-label={t('admin.docs.onThisPage')}>
            <ul>
              {topic.sections.map((sec) => (
                <li key={sec.id}>
                  <a href={`#${sec.id}`} className={styles.tocLink}>
                    {sec.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={t('admin.docs.topics')}>
        {menuOpen && <TopicNav docs={docs} label={t('admin.docs.topics')} />}
      </Sheet>
    </div>
  );
}
