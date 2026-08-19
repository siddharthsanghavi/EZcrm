import Link from 'next/link';
import { CompanyForm } from '@/components/company-form';

export default function NewCompanyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/companies" className="text-sm text-black/50 hover:text-ink">
          ← Companies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add company</h1>
      </div>
      <CompanyForm />
    </div>
  );
}
