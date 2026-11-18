package il.kulmus.pdf;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.widget.Toast;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * גשר בין הממשק (JavaScript) לטלפון:
 *  - saveFile: שמירת קובץ לתיקיית ההורדות (Download/Kulmus)
 *  - printPdf: הדפסת PDF דרך מערכת ההדפסה של אנדרואיד
 *  - takePending + האירוע "incoming": קבצי PDF שנפתחו מאפליקציה אחרת ("פתח באמצעות" / "שיתוף")
 */
@CapacitorPlugin(name = "Kulmus")
public class KulmusPlugin extends Plugin {

    private final List<JSObject> pending = new ArrayList<>();

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        if (intent != null) collect(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (collect(intent)) notifyListeners("incoming", new JSObject());
    }

    /* ---------- קבצים נכנסים ---------- */

    private boolean collect(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        boolean added = false;
        for (Uri u : uris) {
            try {
                JSObject f = new JSObject();
                f.put("name", displayName(u));
                f.put("data", Base64.encodeToString(readAll(u), Base64.NO_WRAP));
                synchronized (pending) { pending.add(f); }
                added = true;
            } catch (Exception e) {
                toast("לא הצלחנו לקרוא את הקובץ");
            }
        }
        // שלא ייפתח שוב אחרי סיבוב מסך או חזרה לאפליקציה
        if (added) intent.setAction(Intent.ACTION_MAIN);
        return added;
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pending) {
            for (JSObject f : pending) arr.put(f);
            pending.clear();
        }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }

    private byte[] readAll(Uri uri) throws IOException {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IOException("no stream");
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) { }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "מסמך.pdf";
        if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
        return name;
    }

    /* ---------- שמירה להורדות ---------- */

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "מסמך.pdf");
        String mime = call.getString("mime", "application/pdf");
        String data = call.getString("data");
        if (data == null) { call.reject("אין נתונים"); return; }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            String where;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver r = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Kulmus");
                Uri uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IOException("insert failed");
                try (OutputStream out = r.openOutputStream(uri)) {
                    if (out == null) throw new IOException("no stream");
                    out.write(bytes);
                }
                where = "הורדות/Kulmus";
            } else {
                File dir = new File(getContext().getExternalFilesDir(null), "Kulmus");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir failed");
                try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
                    out.write(bytes);
                }
                where = dir.getAbsolutePath();
            }
            toast("נשמר: " + name + "\nבתיקייה " + where);
            JSObject ret = new JSObject();
            ret.put("location", where);
            call.resolve(ret);
        } catch (Exception e) {
            toast("השמירה נכשלה");
            call.reject("השמירה נכשלה: " + e.getMessage());
        }
    }

    /* ---------- הדפסה ---------- */

    @PluginMethod
    public void printPdf(PluginCall call) {
        String name = call.getString("name", "מסמך.pdf");
        String data = call.getString("data");
        if (data == null) { call.reject("אין נתונים"); return; }
        final byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintAttributes attrs = new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                pm.print(name, new PdfAdapter(name, bytes, call), attrs);
            } catch (Exception e) {
                call.reject("ההדפסה נכשלה: " + e.getMessage());
            }
        });
    }

    private static class PdfAdapter extends PrintDocumentAdapter {
        private final String name;
        private final byte[] bytes;
        private final PluginCall call;
        private boolean done = false;

        PdfAdapter(String name, byte[] bytes, PluginCall call) {
            this.name = name;
            this.bytes = bytes;
            this.call = call;
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancellationSignal,
                             LayoutResultCallback callback, Bundle extras) {
            if (cancellationSignal.isCanceled()) { callback.onLayoutCancelled(); return; }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name)
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .build();
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal cancellationSignal,
                            WriteResultCallback callback) {
            try (FileOutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                out.write(bytes);
                callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
            } catch (IOException e) {
                callback.onWriteFailed(e.getMessage());
            }
        }

        @Override
        public void onFinish() {
            if (!done) { done = true; call.resolve(); }
        }
    }

    private void toast(String msg) {
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), msg, Toast.LENGTH_LONG).show());
    }
}
