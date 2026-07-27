import type { Metadata } from 'next';
import { ForgotPasswordForm } from './ForgotPasswordForm';

// noindex — recovery pages must never be indexed by search engines.
export const metadata: Metadata = {
  title: 'Recuperar contraseña',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
