import { Card, CardContent, CardHeader, CardTitle, CustomerForm } from '@breakery/ui';
import { useEffect, useRef, type ReactNode } from 'react';

// Soumet le formulaire contenu après montage — seul moyen de montrer l'erreur
// de validation e-mail (elle n'apparaît qu'au submit). Scopé par ref pour ne
// pas toucher les autres cellules de la planche.
const AutoSubmit = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('form')?.requestSubmit();
  }, []);
  return <div ref={ref}>{children}</div>;
};

// Édition d'une cliente existante (module Loyalty du back-office).
export const Backoffice = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Modifier la cliente</CardTitle>
      </CardHeader>
      <CardContent>
        <CustomerForm
          mode="edit"
          initialValues={{ name: 'Ibu Sari Wijaya', phone: '+62 812-3456-7890', email: 'sari.wijaya@gmail.com' }}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      </CardContent>
    </Card>
  </div>
);

// Création — formulaire vierge, bouton Save désactivé tant que le nom < 2 car.
export const Create = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Nouveau client</CardTitle>
      </CardHeader>
      <CardContent>
        <CustomerForm mode="create" onSubmit={() => {}} onCancel={() => {}} />
      </CardContent>
    </Card>
  </div>
);

// Erreur de validation : e-mail incomplet, submit simulé au montage →
// « Invalid email » sous le champ, aria-invalid posé.
export const EmailError = () => (
  <div className="theme-backoffice bg-bg-base p-6">
    <AutoSubmit>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Modifier la cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm
            mode="edit"
            initialValues={{ name: 'Ibu Sari Wijaya', phone: '+62 812-3456-7890', email: 'sari.wijaya@gmail' }}
            onSubmit={() => {}}
            onCancel={() => {}}
          />
        </CardContent>
      </Card>
    </AutoSubmit>
  </div>
);
