import { useTranslation } from 'react-i18next';
import { PhoneInput } from '../components/ui/PhoneInput';
import { TextField } from '../components/ui/TextField';

export type Customer = { name: string; phone: string };

/** Name 1-80 characters (trimmed) and a phone number. */
export const customerErrors = (c: Customer) => ({
  name: c.name.trim().length < 1 || c.name.trim().length > 80,
  phone: c.phone === '',
});

/** Walk-in style customer: name and phone; errors show once `tried`. */
export function CustomerFields({ value, onChange, tried }: { value: Customer; onChange: (next: Customer) => void; tried: boolean }) {
  const { t } = useTranslation();
  const bad = customerErrors(value);
  return (
    <>
      <TextField
        label={t('owner.walkIn.name')}
        value={value.name}
        maxLength={80}
        autoComplete="off"
        error={tried && bad.name ? t('owner.walkIn.nameRequired') : undefined}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <PhoneInput
        label={t('owner.walkIn.phoneLabel')}
        value={value.phone}
        onChange={(phone) => onChange({ ...value, phone })}
        error={tried && bad.phone ? t('owner.walkIn.phoneRequired') : undefined}
      />
    </>
  );
}
