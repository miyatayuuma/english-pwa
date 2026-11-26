package jp.miyatayuuma.kokorop37;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class Phonemizer {
    // Preserve sentence punctuation while letting eSpeak read intra-word apostrophes and decimal points.
    private static final Pattern PUNCTUATION = Pattern.compile(
            "(?<![0-9])\\.|\\.(?![0-9])|[,:;!?—…“”\"()]");
    private static final Pattern ABBREVIATIONS = Pattern.compile(
            "(?i)\\b(Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr)\\.(?=\\s)");
    private static final Pattern LANGUAGE_MARKER = Pattern.compile("\\([a-z]{2}(?:-[a-z]+)?\\)");
    private static final Pattern SPACE = Pattern.compile("\\s+");

    static {
        System.loadLibrary("kokoro_g2p");
    }

    Phonemizer(Path dataParent) { initialize(dataParent.toString()); }

    String convert(String text, String accent) {
        String input = ABBREVIATIONS.matcher(text.strip().replace('’', '\'')).replaceAll("$1");
        Matcher matcher = PUNCTUATION.matcher(input);
        StringBuilder result = new StringBuilder();
        int cursor = 0;
        while (matcher.find()) {
            String piece = input.substring(cursor, matcher.start());
            appendWords(result, piece, accent);
            if (piece.isBlank() && cursor < matcher.start()) result.append(' ');
            result.append(matcher.group());
            cursor = matcher.end();
        }
        appendWords(result, input.substring(cursor), accent);
        return SPACE.matcher(result.toString().strip()).replaceAll(" ");
    }

    private static void appendWords(StringBuilder output, String segment, String accent) {
        if (segment.isBlank()) return;
        String decoded = new String(ipa(segment.strip().getBytes(StandardCharsets.UTF_8), accent), StandardCharsets.UTF_8);
        decoded = LANGUAGE_MARKER.matcher(decoded).replaceAll("").strip();
        if (decoded.isEmpty()) return;
        if (output.length() != 0 && Character.isWhitespace(segment.charAt(0))) output.append(' ');
        output.append(decoded);
    }

    private static native void initialize(String path);
    private static native byte[] ipa(byte[] utf8, String accent);
}
