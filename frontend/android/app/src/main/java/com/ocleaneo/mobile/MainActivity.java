package com.ocleaneo.mobile;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * Après une mise à jour de l'app, la WebView Android conserve son cache HTTP disque
 * d'une installation à l'autre : elle continue de servir l'ancien index.html/bundle JS,
 * qui référence des chunks (hash Vite) supprimés par le nouveau build, d'où des erreurs
 * "Failed to fetch dynamically imported module" et un comportement figé sur l'ancien code.
 * On vide donc le cache au lancement pour garantir que les assets fraîchement synchronisés
 * (npx cap sync) sont toujours ceux effectivement chargés.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Doit précéder super.onCreate() — c'est là que le Bridge construit
        // sa liste de plugins (voir la doc Capacitor sur les plugins natifs
        // maison, par opposition à ceux embarqués comme node_modules).
        registerPlugin(NfcStatusPlugin.class);
        super.onCreate(savedInstanceState);
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        getBridge().getWebView().clearCache(true);
    }
}
