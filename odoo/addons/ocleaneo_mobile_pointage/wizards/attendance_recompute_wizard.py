# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models

_KIND_LABELS = {
    "missing_slice": (
        "Présence manquante : le journal de pointage indique une plage "
        "%(check_in)s → %(check_out)s qui n'existe pas du tout en présence."
    ),
    "should_be_closed": (
        "Présence #%(attendance_id)s ouverte depuis %(check_in)s : le "
        "journal montre qu'elle aurait dû être clôturée à %(expected_check_out)s."
    ),
    "check_out_mismatch": (
        "Présence #%(attendance_id)s : sortie enregistrée à "
        "%(stored_check_out)s, mais le journal indique %(expected_check_out)s "
        "— non modifiée automatiquement, à vérifier manuellement."
    ),
    "closed_but_log_says_open": (
        "Présence #%(attendance_id)s clôturée à %(stored_check_out)s alors "
        "que le journal ne montre aucun départ ce jour-là — probablement une "
        "correction manuelle légitime, non modifiée."
    ),
    "unmatched_attendance": (
        "Présence #%(attendance_id)s (%(check_in)s → %(check_out)s) sans "
        "pointage mobile correspondant ce jour-là — probablement saisie "
        "manuellement, non modifiée."
    ),
}


def _format_discrepancy(d):
    d = dict(d)
    d.setdefault("check_out", "en cours")
    d.setdefault("expected_check_out", "en cours")
    return _KIND_LABELS.get(d["kind"], str(d)) % d


class AttendanceRecomputeWizard(models.TransientModel):
    _name = "ocleaneo.attendance.recompute.wizard"
    _description = "Recalcul de présence sur une journée suspecte"

    employee_id = fields.Many2one("hr.employee", string="Salarié", required=True)
    date = fields.Date(string="Journée", required=True, default=fields.Date.context_today)
    apply = fields.Boolean(
        string="Appliquer les corrections",
        help="Sans cette case, l'analyse est un aperçu (dry-run) : rien n'est "
             "écrit. Cochée, seules les présences manquantes sont créées et "
             "les présences restées ouvertes à tort sont clôturées — jamais "
             "une présence existante n'est modifiée ou supprimée autrement, "
             "au cas où elle porterait une correction manuelle légitime.",
    )
    result = fields.Text(string="Résultat", readonly=True)

    def action_run(self):
        self.ensure_one()
        discrepancies = self.env["hr.attendance"].sudo().recompute_attendance(
            self.employee_id.id, self.date, apply=self.apply,
        )
        if not discrepancies:
            result = "Aucun écart : les présences de cette journée correspondent au journal de pointage."
        else:
            prefix = "Corrections appliquées" if self.apply else "Aperçu (rien n'a été écrit)"
            lines = ["%s — %s écart(s) détecté(s) :" % (prefix, len(discrepancies))]
            lines += ["- %s" % _format_discrepancy(d) for d in discrepancies]
            result = "\n".join(lines)
        self.result = result
        return {
            "type": "ir.actions.act_window",
            "res_model": self._name,
            "res_id": self.id,
            "view_mode": "form",
            "target": "new",
        }
