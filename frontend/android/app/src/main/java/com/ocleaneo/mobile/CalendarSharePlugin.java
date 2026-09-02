package com.ocleaneo.mobile;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * @capacitor/share (SharePlugin.java) laisse Android deviner le type MIME
 * d'un fichier partagé via MimeTypeMap.getMimeTypeFromExtension() — cette
 * table intégrée à l'OS ne connaît ".ics" sur aucune version d'Android
 * testée, et le plugin retombe alors sur "*\/*". Or les applications
 * Calendrier (Google Agenda, Samsung Calendar...) déclarent leur
 * intent-filter sur "text/calendar" précisément : avec "*\/*", aucune
 * n'apparaît jamais dans la feuille de partage — l'agent n'a alors aucun
 * moyen d'ajouter le planning exporté à son agenda personnel en un geste.
 *
 * Ce plugin pose le type explicitement, sans passer par cette détection.
 * Pour le reste, il reprend délibérément le même mécanisme que SharePlugin
 * (BroadcastReceiver sur EXTRA_CHOSEN_COMPONENT + startActivityForResult) :
 * une première version se contentait de startActivity (sans attendre de
 * résultat), donc incapable de dire si l'agent avait réellement choisi une
 * application ou refermé la feuille — la seule information disponible côté
 * JS était "la feuille s'est ouverte sans planter", jamais "c'est fait".
 * Avec ce mécanisme, shareIcs() se comporte exactement comme Share.share()
 * (résout en cas de partage réel, rejette avec "Share canceled" sinon) :
 * calendarExport.ts peut traiter les deux plateformes de la même façon.
 */
@CapacitorPlugin(name = "CalendarShare")
public class CalendarSharePlugin extends Plugin {

    private BroadcastReceiver broadcastReceiver;
    private boolean stopped = false;
    private ComponentName chosenComponent;

    @Override
    public void load() {
        broadcastReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    chosenComponent = intent.getParcelableExtra(Intent.EXTRA_CHOSEN_COMPONENT, ComponentName.class);
                } else {
                    chosenComponent = getParcelableExtraLegacy(intent);
                }
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            broadcastReceiver,
            new IntentFilter(Intent.EXTRA_CHOSEN_COMPONENT),
            ContextCompat.RECEIVER_EXPORTED
        );
    }

    @SuppressWarnings("deprecation")
    private ComponentName getParcelableExtraLegacy(Intent intent) {
        return intent.getParcelableExtra(Intent.EXTRA_CHOSEN_COMPONENT);
    }

    @ActivityCallback
    private void activityResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_CANCELED && !stopped) {
            call.reject("Share canceled");
        } else {
            JSObject callResult = new JSObject();
            callResult.put("activityType", chosenComponent != null ? chosenComponent.getPackageName() : "");
            call.resolve(callResult);
        }
    }

    @PluginMethod
    public void shareIcs(PluginCall call) {
        String path = call.getString("path");
        String title = call.getString("title", "Planning Ocleaneo");
        if (path == null) {
            call.reject("path manquant");
            return;
        }
        try {
            Uri fileUri = FileProvider.getUriForFile(
                getActivity(),
                getContext().getPackageName() + ".fileprovider",
                new File(Uri.parse(path).getPath())
            );

            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/calendar");
            intent.putExtra(Intent.EXTRA_STREAM, fileUri);
            intent.putExtra(Intent.EXTRA_SUBJECT, title);
            intent.setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                intent.setClipData(ClipData.newRawUri("", fileUri));
            }

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags | PendingIntent.FLAG_MUTABLE;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                flags = flags | PendingIntent.FLAG_ALLOW_UNSAFE_IMPLICIT_INTENT;
            }
            // requestCode non utilisé — 0, comme SharePlugin.
            PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, new Intent(Intent.EXTRA_CHOSEN_COMPONENT), flags);
            Intent chooser = Intent.createChooser(intent, title, pi.getIntentSender());
            chosenComponent = null;
            chooser.addCategory(Intent.CATEGORY_DEFAULT);
            stopped = false;
            startActivityForResult(call, chooser, "activityResult");
        } catch (Exception e) {
            call.reject(e.getLocalizedMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (broadcastReceiver != null) {
            getActivity().unregisterReceiver(broadcastReceiver);
        }
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        stopped = true;
    }
}
