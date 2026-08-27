# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Le contrat de l'API mobile : versionnement des chemins, bornes des plages.

Deux constats de l'audit se rejoignent ici, parce que tous deux portent sur
ce que l'API *promet* à un client qu'elle ne maîtrise pas :

- F-05 : aucune route n'était versionnée. L'application s'installe sur les
  téléphones des salariés et se met à jour à LEUR rythme, pas à celui du
  serveur : le jour où une réponse change de forme, anciens et nouveaux
  clients coexistent pendant des semaines. Sans version dans le chemin, il
  ne reste que deux options — casser le terrain, ou ne plus jamais faire
  évoluer un contrat. Posé avant tout déploiement, c'est-à-dire au seul
  moment où cela ne coûte rien : aucune application n'étant installée, il n'y
  a aucun alias non versionné à maintenir.

- F-06 : /planning et /pointage/mine acceptaient une plage de dates sans
  limite et lançaient un search() sans `limit`.
"""

from odoo.tests.common import TransactionCase

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    API_VERSION,
    SUPPORTED_VERSIONS,
    mobile_routes,
)
from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import (
    MAX_RANGE_DAYS,
    DateRangeError,
    check_range,
)

from datetime import date, timedelta


class TestRouteVersioning(TransactionCase):

    def test_an_endpoint_is_served_on_its_versioned_path_only(self):
        """Rien n'étant encore déployé, il n'y a aucun client historique à
        ménager : un alias non versionné serait du poids mort dès le premier
        jour, et inviterait à emprunter un chemin qu'il faudrait retirer
        ensuite."""
        self.assertEqual(mobile_routes("planning"), ["/api/mobile/v1/planning"])

    def test_nested_paths_are_versioned_too(self):
        """Le défaut classique d'un préfixage naïf : /auth/login devient
        /api/mobile/v1auth/login ou perd son segment."""
        self.assertEqual(mobile_routes("auth/login"), ["/api/mobile/v1/auth/login"])

    def test_leading_slash_is_tolerated(self):
        self.assertEqual(mobile_routes("/planning"), mobile_routes("planning"))

    def test_no_declared_route_escapes_the_version(self):
        """Le test qui compte vraiment : il parcourt les contrôleurs réellement
        chargés, pas une liste écrite à la main qui se périmerait au premier
        endpoint ajouté. Un `@http.route("/api/mobile/x")` écrit en dur — le
        réflexe naturel — est attrapé ici."""
        from odoo import http

        mobile_paths = set()
        for cls in http.Controller.__subclasses__():
            for attr in vars(cls).values():
                for path in getattr(attr, "routing", {}).get("routes", []):
                    # Le préflight CORS est exclu : son convertisseur
                    # <path:subpath> couvre toute l'API par construction, y
                    # compris les chemins versionnés.
                    if path.startswith("/api/mobile/") and "<" not in path:
                        mobile_paths.add(path)

        self.assertTrue(mobile_paths, "aucune route mobile trouvée")
        prefix = "/api/mobile/%s/" % API_VERSION
        hors_version = sorted(p for p in mobile_paths if not p.startswith(prefix))
        self.assertEqual(
            hors_version, [], "routes servies hors version : %s" % hors_version
        )

    def test_supported_versions_contains_the_current_one(self):
        """/config annonce ces valeurs à l'application : elles doivent être
        cohérentes entre elles."""
        self.assertIn(API_VERSION, SUPPORTED_VERSIONS)


class TestDateRangeBounds(TransactionCase):

    def test_a_normal_month_passes(self):
        """La vue Mois du frontend, le cas le plus large en usage réel."""
        start = date(2026, 3, 1)
        self.assertEqual(check_range(start, date(2026, 3, 31)), 31)

    def test_a_single_day_passes(self):
        self.assertEqual(check_range(date(2026, 3, 10), date(2026, 3, 10)), 1)

    def test_the_exact_limit_passes(self):
        """La borne est inclusive : refuser pile à la limite serait un défaut
        de bord classique."""
        start = date(2026, 1, 1)
        self.assertEqual(
            check_range(start, start + timedelta(days=MAX_RANGE_DAYS - 1)),
            MAX_RANGE_DAYS,
        )

    def test_one_day_past_the_limit_is_refused(self):
        start = date(2026, 1, 1)
        with self.assertRaises(DateRangeError) as caught:
            check_range(start, start + timedelta(days=MAX_RANGE_DAYS))
        self.assertEqual(caught.exception.payload["error"], "range_too_wide")
        self.assertEqual(caught.exception.payload["code"], 400)
        self.assertEqual(caught.exception.payload["max_days"], MAX_RANGE_DAYS)

    def test_the_whole_history_is_refused(self):
        """Le cas qui motive la borne : rien n'empêchait un client de demander
        l'intégralité de l'historique, chargé en mémoire dans un worker Odoo
        pour être sérialisé en JSON vers un téléphone."""
        with self.assertRaises(DateRangeError):
            check_range(date(1970, 1, 1), date(2999, 12, 31))

    def test_an_inverted_range_is_refused_rather_than_silently_empty(self):
        """Auparavant : fenêtre vide, donc « aucune vacation » — indiscernable
        d'une vraie journée libre. C'est exactement la classe de défaut déjà
        corrigée côté frontend (un écran vide qui ment sur la réalité)."""
        with self.assertRaises(DateRangeError) as caught:
            check_range(date(2026, 3, 31), date(2026, 3, 1))
        self.assertEqual(caught.exception.payload["error"], "invalid_range")
        self.assertEqual(caught.exception.payload["code"], 400)

    def test_the_error_carries_a_payload_the_controller_can_return_as_is(self):
        """Les contrôleurs font `return e.payload` : la charge utile doit être
        directement sérialisable et porter le même contrat d'erreur que le
        reste de l'API (error + code)."""
        with self.assertRaises(DateRangeError) as caught:
            check_range(date(2026, 3, 31), date(2026, 3, 1))
        payload = caught.exception.payload
        self.assertIsInstance(payload, dict)
        self.assertEqual(sorted(payload)[:2], ["code", "detail"])
