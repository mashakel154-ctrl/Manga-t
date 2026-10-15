package app.mangatranslator

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private class Lang(
        val label: String,
        val code: String,
        val google: String,
        val noSpace: Boolean,
        val make: () -> TextRecognizer
    )

    private val langs = listOf(
        Lang("يابانية", TranslateLanguage.JAPANESE, "ja", true) {
            TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        },
        Lang("كورية", TranslateLanguage.KOREAN, "ko", false) {
            TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        },
        Lang("صينية", TranslateLanguage.CHINESE, "zh-CN", true) {
            TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        },
        Lang("إنجليزية", TranslateLanguage.ENGLISH, "en", false) {
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        }
    )

    private val geminiModels = listOf("gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite")

    private lateinit var web: WebView
    private lateinit var urlBox: EditText
    private lateinit var keyBox: EditText
    private lateinit var langSpinner: Spinner
    private lateinit var statusView: TextView
    private val pool = Executors.newSingleThreadExecutor()
    private val prefs by lazy { getSharedPreferences("mt", Context.MODE_PRIVATE) }
    private val translatorJs: String by lazy {
        assets.open("translator.js").bufferedReader().use { it.readText() }
    }

    @Volatile
    private var running = false

    @Volatile
    private var aiError = ""

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(8), dp(8), 0)
        }

        urlBox = EditText(this).apply {
            hint = "الصق رابط الموقع هنا"
            setSingleLine(true)
            textDirection = android.view.View.TEXT_DIRECTION_LTR
            imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { _, id, _ ->
                if (id == EditorInfo.IME_ACTION_GO) { go(); true } else false
            }
        }
        val goBtn = Button(this).apply { text = "اذهب"; setOnClickListener { go() } }
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(urlBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(goBtn)
        }

        langSpinner = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                langs.map { it.label }
            )
        }
        val translateBtn = Button(this).apply { text = "ترجم"; setOnClickListener { startTranslation() } }
        val toggleBtn = Button(this).apply {
            text = "إخفاء/إظهار"
            setOnClickListener { web.evaluateJavascript("window.MT && MT.toggle()", null) }
        }
        val clearBtn = Button(this).apply {
            text = "مسح"
            setOnClickListener { web.evaluateJavascript("window.MT && MT.clear()", null); setStatus("تم المسح.") }
        }
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(langSpinner, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(translateBtn)
            addView(toggleBtn)
            addView(clearBtn)
        }

        keyBox = EditText(this).apply {
            hint = "مفتاح Gemini المجاني (اختياري)"
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            textDirection = android.view.View.TEXT_DIRECTION_LTR
            setText(prefs.getString("gemini", "") ?: "")
        }
        val saveKeyBtn = Button(this).apply {
            text = "حفظ"
            setOnClickListener {
                val k = keyBox.text.toString().trim()
                prefs.edit().putString("gemini", k).apply()
                setStatus(
                    if (k.isEmpty()) "تم حذف المفتاح، سيُستخدم المترجم العادي."
                    else "تم حفظ المفتاح. ستُترجم الصفحات بواسطة Gemini."
                )
            }
        }
        val row3 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(keyBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(saveKeyBtn)
        }

        statusView = TextView(this).apply {
            text = "الصق رابط الموقع، افتحه، ثم اضغط ترجم."
            textSize = 13f
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.loadWithOverviewMode = true
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    if (url != null) urlBox.setText(url)
                    view?.evaluateJavascript(translatorJs, null)
                }
            }
        }

        root.addView(row1)
        root.addView(row2)
        root.addView(row3)
        root.addView(statusView)
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        web.loadUrl("https://www.google.com")
    }

    private fun go() {
        var u = urlBox.text.toString().trim()
        if (u.isEmpty()) return
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            u = if (u.contains(".") && !u.contains(" ")) "https://$u"
            else "https://www.google.com/search?q=" + Uri.encode(u)
        }
        web.loadUrl(u)
    }

    private fun setStatus(msg: String) {
        runOnUiThread { statusView.text = msg }
    }

    private fun startTranslation() {
        if (running) return
        val lang = langs[langSpinner.selectedItemPosition]
        val ua = web.settings.userAgentString
        val referer = web.url ?: ""
        val apiKey = (prefs.getString("gemini", "") ?: "").trim()
        web.evaluateJavascript(translatorJs, null)
        web.evaluateJavascript("window.MT ? MT.collect() : '[]'") { raw ->
            val json = try {
                JSONTokener(raw).nextValue() as? String ?: "[]"
            } catch (e: Exception) {
                "[]"
            }
            val arr = try { JSONArray(json) } catch (e: Exception) { JSONArray() }
            if (arr.length() == 0) {
                web.evaluateJavascript("window.MT ? MT.info() : ''") { r ->
                    val info = try { JSONTokener(r).nextValue() as? String ?: "" } catch (e: Exception) { "" }
                    setStatus("لم أجد صورًا جديدة للترجمة. $info")
                }
                return@evaluateJavascript
            }
            running = true
            pool.execute { process(arr, lang, ua, referer, apiKey) }
        }
    }

    private fun cleanText(raw: String, noSpace: Boolean): String {
        var t = raw.replace("-\n", "")
            .replace("\n", if (noSpace) "" else " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (noSpace) {
            t = t.replace(" ", "")
        } else {
            val letters = t.filter { it.isLetter() }
            if (letters.length >= 3 && letters.count { it.isUpperCase() } >= letters.length * 0.8) {
                t = t.lowercase().replaceFirstChar { it.uppercase() }
                t = t.replace(Regex("\\bi\\b"), "I")
            }
        }
        return t
    }

    private fun onlineTranslate(text: String, from: String, to: String): String? {
        return try {
            val u = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
                "&sl=" + Uri.encode(from) + "&tl=" + Uri.encode(to) + "&q=" + Uri.encode(text)
            val c = URL(u).openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 12000
            c.setRequestProperty("User-Agent", "Mozilla/5.0")
            if (c.responseCode != 200) return null
            val body = c.inputStream.bufferedReader().use { it.readText() }
            val parts = JSONArray(body).getJSONArray(0)
            val sb = StringBuilder()
            for (i in 0 until parts.length()) {
                sb.append(parts.getJSONArray(i).optString(0, ""))
            }
            sb.toString().trim().ifEmpty { null }
        } catch (e: Exception) {
            null
        }
    }

    private fun geminiTranslate(texts: List<String>, lang: Lang, key: String): List<String>? {
        val items = JSONArray()
        texts.forEach { items.put(it) }
        val prompt = "You are a professional manga and webtoon translator. " +
            "Translate the following speech bubble texts from the language with code '${lang.google}' into Arabic. " +
            "They come from one page, in reading order, so use the context of the whole page. " +
            "Use natural Modern Standard Arabic dialogue that fits each character's tone. " +
            "Keep each translation short enough to fit a speech bubble. " +
            "Transliterate character names consistently. Keep punctuation like ... ! ? when it carries tone. " +
            "Return ONLY a JSON array of exactly ${texts.size} strings, in the same order as the input. " +
            "Input: " + items.toString()
        val body = JSONObject()
            .put(
                "contents",
                JSONArray().put(
                    JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt)))
                )
            )
            .put(
                "generationConfig",
                JSONObject()
                    .put("temperature", 0.3)
                    .put("responseMimeType", "application/json")
                    .put(
                        "responseSchema",
                        JSONObject().put("type", "ARRAY").put("items", JSONObject().put("type", "STRING"))
                    )
            )
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        for (model in geminiModels) {
            try {
                val c = URL("https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent")
                    .openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.doOutput = true
                c.connectTimeout = 10000
                c.readTimeout = 45000
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("x-goog-api-key", key)
                c.outputStream.use { it.write(bytes) }
                if (c.responseCode != 200) {
                    aiError = "رمز ${c.responseCode}"
                    continue
                }
                val resp = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                val parts = resp.getJSONArray("candidates").getJSONObject(0)
                    .getJSONObject("content").getJSONArray("parts")
                val sb = StringBuilder()
                for (i in 0 until parts.length()) {
                    val p = parts.getJSONObject(i)
                    if (!p.optBoolean("thought", false)) sb.append(p.optString("text", ""))
                }
                val out = JSONArray(sb.toString().trim())
                if (out.length() != texts.size) {
                    aiError = "رد غير مكتمل"
                    continue
                }
                val list = ArrayList<String>()
                for (i in 0 until out.length()) list.add(out.getString(i).trim())
                if (list.any { it.isEmpty() }) {
                    aiError = "رد فارغ"
                    continue
                }
                return list
            } catch (e: Exception) {
                aiError = "فشل الاتصال"
            }
        }
        return null
    }

    private fun process(arr: JSONArray, lang: Lang, ua: String, referer: String, apiKey: String) {
        val recognizer = lang.make()
        val translator = Translation.getClient(
            TranslatorOptions.Builder()
                .setSourceLanguage(lang.code)
                .setTargetLanguage(TranslateLanguage.ARABIC)
                .build()
        )
        var okCount = 0
        var emptyCount = 0
        var failCount = 0
        var skipped = 0
        var usedAi = 0
        var modelState = 0
        aiError = ""

        fun offlineTranslate(src: String): String? {
            if (modelState == 2) return null
            return try {
                if (modelState == 0) {
                    setStatus("تنزيل نموذج الترجمة بدون إنترنت...")
                    Tasks.await(translator.downloadModelIfNeeded(DownloadConditions.Builder().build()))
                    modelState = 1
                }
                Tasks.await(translator.translate(src))
            } catch (e: Exception) {
                modelState = 2
                null
            }
        }

        try {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val id = o.getString("id")
                setStatus("الصورة ${i + 1} من ${arr.length()}...")
                try {
                    val bmp = download(o.getString("url"), ua, referer)
                        ?: throw IllegalStateException("download")
                    val text = Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0)))

                    val srcs = ArrayList<String>()
                    val rects = ArrayList<Rect>()
                    for (block in text.textBlocks) {
                        val rect = block.boundingBox ?: continue
                        val s = cleanText(block.text, lang.noSpace)
                        if (s.none { it.isLetterOrDigit() }) continue
                        srcs.add(s)
                        rects.add(rect)
                    }

                    val ai = if (srcs.isNotEmpty() && apiKey.isNotEmpty()) {
                        setStatus("الصورة ${i + 1} من ${arr.length()}: ترجمة Gemini...")
                        geminiTranslate(srcs, lang, apiKey)
                    } else {
                        null
                    }
                    if (ai != null) usedAi++
                    val trs: List<String?> = ai
                        ?: srcs.map { onlineTranslate(it, lang.google, "ar") ?: offlineTranslate(it) }

                    val boxes = JSONArray()
                    for (k in srcs.indices) {
                        val tr = trs[k]
                        if (tr == null) {
                            skipped++
                            continue
                        }
                        val rect = rects[k]
                        boxes.put(
                            JSONObject()
                                .put("x0", rect.left).put("y0", rect.top)
                                .put("x1", rect.right).put("y1", rect.bottom)
                                .put("text", tr)
                        )
                    }
                    val res = JSONObject()
                        .put("id", id)
                        .put("w", bmp.width)
                        .put("boxes", boxes)
                    bmp.recycle()
                    if (boxes.length() == 0) emptyCount++ else okCount++
                    runOnUiThread { web.evaluateJavascript("MT.place($res)", null) }
                } catch (e: Exception) {
                    failCount++
                    runOnUiThread { web.evaluateJavascript("MT.unmark('$id')", null) }
                }
            }
            var msg = "انتهت الترجمة: نجحت $okCount، بدون نص $emptyCount، فشلت $failCount."
            if (apiKey.isNotEmpty()) {
                if (usedAi > 0) {
                    msg += " ترجم Gemini $usedAi صفحة."
                } else {
                    val err = if (aiError.isNotEmpty()) " ($aiError)" else ""
                    msg += " تعذّر Gemini$err، استُخدم المترجم العادي."
                }
            }
            if (skipped > 0) msg += " تعذّرت ترجمة $skipped مقطع."
            setStatus("$msg اضغط ترجم مرة ثانية للصور التالية.")
        } catch (e: Exception) {
            setStatus("حدث خطأ أثناء الترجمة. أعد المحاولة.")
        } finally {
            recognizer.close()
            translator.close()
            running = false
        }
    }

    private fun download(url: String, ua: String, referer: String): Bitmap? {
        val bytes: ByteArray = if (url.startsWith("data:")) {
            Base64.decode(url.substringAfter(","), Base64.DEFAULT)
        } else if (url.startsWith("http")) {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 15000
            c.readTimeout = 30000
            c.setRequestProperty("User-Agent", ua)
            if (referer.isNotEmpty()) c.setRequestProperty("Referer", referer)
            CookieManager.getInstance().getCookie(url)?.let { c.setRequestProperty("Cookie", it) }
            c.inputStream.use { it.readBytes() }
        } else {
            return null
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 3000) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        pool.shutdown()
        super.onDestroy()
    }
}
