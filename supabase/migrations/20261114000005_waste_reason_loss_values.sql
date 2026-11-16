-- S1-18 (1/2) — la liste fermée des motifs de perte reçoit quatre valeurs.
--
-- Décision de Mamat (04_QUESTIONS_CLARIFICATION, S07, lot 7) : liste fermée,
-- comme en production. Décision du 2026-11-14 : `expired`, `leftover`,
-- `damaged` et `other` rejoignent le type `waste_reason`, commun à la
-- production, au stock et à la vitrine.
--
-- Fichier séparé à dessein : une valeur d'énumération ajoutée ne peut pas être
-- utilisée dans la transaction qui l'ajoute. La suite est dans le fichier
-- suivant.

ALTER TYPE public.waste_reason ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE public.waste_reason ADD VALUE IF NOT EXISTS 'leftover';
ALTER TYPE public.waste_reason ADD VALUE IF NOT EXISTS 'damaged';
ALTER TYPE public.waste_reason ADD VALUE IF NOT EXISTS 'other';
