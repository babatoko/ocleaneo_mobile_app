package com.ocleaneo.mobile;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
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
 * Volontairement sans résultat attendu (pas de startActivityForResult) :
 * contrairement à SharePlugin, on n'a pas besoin de savoir si l'agent a
 * effectivement partagé ou fermé la feuille — voir calendarExport.ts, où une
 * annulation n'est de toute façon plus traitée comme une erreur.
 */
@CapacitorPlugin(name = "CalendarShare")
public class CalendarSharePlugin extends Plugin {

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

            getActivity().startActivity(Intent.createChooser(intent, title));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getLocalizedMessage());
        }
    }
}
