import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { addPerson, deletePerson, importPeople } from './actions';

export const metadata = { title: 'People' };

// The directory: employees from any department and volunteers, one shape (PRD 3).
export default async function People({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const people = await db.person.findMany({ where: inOrg(ctx), orderBy: { name: 'asc' } });
  const bind = <A extends unknown[], R>(fn: (slug: string, ...a: A) => R) => fn.bind(null, ctx.slug);

  return (
    <main>
      <h1>People</h1>
      <p>{people.length} in the directory: {people.filter((p) => p.kind === 'employee').length} employees, {people.filter((p) => p.kind === 'volunteer').length} volunteers.</p>
      <table>
        <thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>Kind</th><th>Department</th><th></th></tr></thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.mobile}{p.smsOptOut && ' (no SMS)'}</td><td>{p.email}</td><td>{p.kind}</td><td>{p.department}</td>
              <td>
                <ActionForm action={bind(deletePerson)}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" aria-label={`Remove ${p.name}`}>Remove</button>
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add a person</h2>
      <ActionForm action={bind(addPerson)}>
        <label>Name <input name="name" required maxLength={120} /></label>
        <label>Mobile <input name="mobile" required inputMode="tel" placeholder="555-010-1234" /></label>
        <label>Email <input name="email" type="email" /></label>
        <label>Kind <select name="kind" defaultValue="volunteer"><option value="employee">Employee</option><option value="volunteer">Volunteer</option></select></label>
        <label>Department <input name="department" maxLength={80} /></label>
        <button type="submit">Add person</button>
      </ActionForm>

      <h2>Import from CSV</h2>
      <p>Paste rows with a header line. Columns: name, mobile (or phone), email, kind (employee or volunteer), department. A mobile already in the directory is updated, not duplicated.</p>
      <ActionForm action={bind(importPeople)}>
        <label>CSV <textarea name="csv" rows={8} cols={80} placeholder={'name,mobile,email,kind,department\nJen Park,555-010-2001,jen@example.com,employee,Finance'} /></label>
        <button type="submit">Import</button>
      </ActionForm>
    </main>
  );
}
