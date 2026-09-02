package com.ocleaneo.mobile;

import android.content.Intent;
import android.nfc.NfcAdapter;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Le plugin NFC tiers utilisé par l'app (@exxili/capacitor-nfc) sait dire si
 * l'appareil POSSÈDE une puce NFC (isSupported), mais pas si le NFC est
 * actuellement ACTIVÉ dans les réglages Android. Sans cette information, un
 * salarié dont le NFC est éteint approche son badge sans que rien ne se
 * passe jamais côté écran Pointage (la lecture Android est passive, voir
 * services/nfc.ts) — indiscernable pour lui d'un badge simplement non lu.
 */
@CapacitorPlugin(name = "NfcStatus")
public class NfcStatusPlugin extends Plugin {

    @PluginMethod
    public void isEnabled(PluginCall call) {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        JSObject ret = new JSObject();
        ret.put("supported", adapter != null);
        ret.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(ret);
    }

    /** Ouvre directement l'écran de réglages NFC d'Android, pour que le
     *  salarié n'ait pas à le chercher lui-même dans les Paramètres. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NFC_SETTINGS);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
