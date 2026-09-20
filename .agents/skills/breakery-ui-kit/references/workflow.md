# breakery-ui-kit — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Patterns et checklists

## Patterns et checklists

### Dialog stepper multi-step

Pattern canonique : un `Dialog` unique + state machine (`step: 1 | 2 | ...`) contrôle quel contenu est rendu dans `DialogContent`. Pas de nesting de Dialog.

```tsx
const [step, setStep] = useState<1 | 2>(1);
<Dialog open={open} onOpenChange={onClose}>
  <DialogContent>
    {step === 1 && <Step1 onNext={() => setStep(2)} />}
    {step === 2 && <Step2 onBack={() => setStep(1)} onSubmit={handleSubmit} />}
  </DialogContent>
</Dialog>
```

### Sheet drawer drill-down

`SheetContent` côté `"right"` pour détails inline (exemple : `JournalEntryDetailDrawer`). Ne pas l'utiliser pour des actions destructives — préférer un `Dialog`.

### Badge color-coded status

```tsx
<Badge variant="success">Approved</Badge>   // --success
<Badge variant="warning">Pending</Badge>    // --warning
<Badge variant="destructive">Voided</Badge> // --danger
<Badge variant="outline">Draft</Badge>
```

Les variants exacts dépendent de la définition dans `Badge.tsx` — vérifier avant d'utiliser un variant inconnu.

### useIdleTimeout

Monté une seule fois dans le shell POS et le shell BO. Le hook prend des **minutes**, pas des millisecondes :

```tsx
useIdleTimeout({
  timeoutMinutes: role.session_timeout_minutes,
  onTimeout: () => supabase.auth.signOut(),
  // events?: liste d'événements d'activité — défaut mousedown/keydown/touchstart/scroll
});
```

No-op si `timeoutMinutes <= 0` (rôle pas encore hydraté, ou déconnexion auto désactivée).

---
