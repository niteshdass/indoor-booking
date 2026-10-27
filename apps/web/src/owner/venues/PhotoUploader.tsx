import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../../components/ui/Spinner';
import { apiUpload } from '../../lib/apiClient';
import { compressImage, MAX_UPLOAD_BYTES } from '../../lib/compressImage';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { MAX_PHOTOS, type VenueDraft } from './venueForm';
import styles from './venues.module.css';

type Photo = VenueDraft['photos'][number];

/** A file on its way up: a local preview while it is compressed and sent, or the reason it failed. */
type Pending = { key: number; preview: string; status: 'compressing' | 'uploading' | 'failed'; error?: string };

export type PhotoUploaderProps = {
  photos: Photo[];
  readOnly: boolean;
  error?: string;
  onAdd: (photo: Photo) => void;
  onRemove: (index: number) => void;
  onAlt: (index: number, alt: string) => void;
  /** Files still compressing or uploading; the form waits for them. */
  onBusy: (busy: boolean) => void;
};

let nextKey = 1;

/**
 * Up to `MAX_PHOTOS` venue photos. Picked or dropped files are shrunk in the browser (`compressImage`), uploaded
 * to the owner's image store, and added in the order they finish. The first photo is the venue's cover.
 */
export function PhotoUploader({ photos, readOnly, error, onAdd, onRemove, onAlt, onBusy }: PhotoUploaderProps) {
  const { t } = useTranslation();
  const { ownerId } = useOwner();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = pending.some((p) => p.status !== 'failed');
  useEffect(() => onBusy(busy), [busy, onBusy]);
  // Previews are object URLs; free them when the uploader goes away.
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const free = MAX_PHOTOS - photos.length - pending.filter((p) => p.status !== 'failed').length;
  const patch = (key: number, next: Partial<Pending>) => setPending((all) => all.map((p) => (p.key === key ? { ...p, ...next } : p)));
  const drop = (key: number) =>
    setPending((all) => {
      const gone = all.find((p) => p.key === key);
      if (gone) {
        URL.revokeObjectURL(gone.preview);
        previews.current.delete(gone.preview);
      }
      return all.filter((p) => p.key !== key);
    });

  const upload = async (file: File, key: number) => {
    let blob: Blob;
    try {
      blob = await compressImage(file);
    } catch {
      patch(key, { status: 'failed', error: t('owner.venues.photoUnreadable') });
      return;
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      patch(key, { status: 'failed', error: t('owner.venues.photoTooBig') });
      return;
    }
    patch(key, { status: 'uploading' });
    try {
      const { image } = await apiUpload<{ image: { id: string; url: string } }>(ownerPath(ownerId, '/images'), blob);
      onAdd({ url: image.url, alt: '' });
      drop(key);
    } catch (err) {
      patch(key, { status: 'failed', error: errorMessage(err, t) });
    }
  };

  const take = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const images = [...files].filter((f) => f.type.startsWith('image/') || f.type === '');
    const batch = images.slice(0, Math.max(0, free));
    setNotice(images.length > batch.length ? t('owner.venues.photoLimit', { count: MAX_PHOTOS }) : null);
    const added = batch.map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      return { file, item: { key: nextKey++, preview, status: 'compressing' as const } };
    });
    setPending((all) => [...all, ...added.map((a) => a.item)]);
    added.forEach((a) => void upload(a.file, a.item.key));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!readOnly) take(e.dataTransfer.files);
  };

  return (
    <div className={styles.photos}>
      {(photos.length > 0 || pending.length > 0) && (
        <ul className={styles.photoList}>
          {photos.map((p, i) => (
            <li key={p.url} className={styles.photoItem}>
              <div className={styles.thumb}>
                <img src={p.url} alt="" loading="lazy" />
                {i === 0 && <span className={styles.cover}>{t('owner.venues.cover')}</span>}
              </div>
              <input
                className={styles.altInput}
                aria-label={t('owner.venues.photoAlt', { n: i + 1 })}
                placeholder={t('owner.venues.altPlaceholder')}
                maxLength={200}
                value={p.alt}
                disabled={readOnly}
                onChange={(e) => onAlt(i, e.target.value)}
              />
              {!readOnly && (
                <button type="button" className={styles.photoRemove} aria-label={t('owner.venues.removePhoto', { n: i + 1 })} onClick={() => onRemove(i)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.key} className={styles.photoItem}>
              <div className={styles.thumb} data-busy={p.status !== 'failed' || undefined}>
                <img src={p.preview} alt="" />
              </div>
              {p.status === 'failed' ? (
                <p className={styles.photoError} role="alert">
                  {p.error}
                </p>
              ) : (
                <p className={styles.photoStatus}>
                  <Spinner label={t(p.status === 'compressing' ? 'owner.venues.compressing' : 'owner.venues.uploading')} />
                  <span aria-hidden="true">{t(p.status === 'compressing' ? 'owner.venues.compressing' : 'owner.venues.uploading')}</span>
                </p>
              )}
              {p.status === 'failed' && (
                <button type="button" className={styles.photoRemove} aria-label={t('owner.venues.dismissPhoto')} onClick={() => drop(p.key)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && free > 0 && (
        <label
          className={styles.drop}
          data-over={over || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <input
            ref={input}
            className={styles.fileInput}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            onChange={(e) => {
              take(e.target.files);
              e.target.value = '';
            }}
          />
          <svg className={styles.dropIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          <span className={styles.dropTitle}>{t('owner.venues.uploadPhotos')}</span>
          <span className={styles.dropHint}>{t('owner.venues.uploadHint', { count: free })}</span>
        </label>
      )}
      {notice && <p className={styles.photoNotice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
