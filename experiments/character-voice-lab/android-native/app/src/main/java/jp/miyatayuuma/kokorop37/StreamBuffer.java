package jp.miyatayuuma.kokorop37;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

final class StreamBuffer {
    private static final int LIMIT = 155;
    private static final Pattern SENTENCE = Pattern.compile("[.!?][\"'’”)]*(?=\\s)");
    private static final Pattern ABBREVIATION =
            Pattern.compile("(?i)\\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|[A-Z])\\.$");
    private static final Pattern CLAUSE = Pattern.compile("[,;:—](?=\\s)");

    private String pending = "";

    List<String> push(String token, boolean done) {
        pending += token;
        List<String> result = new ArrayList<>();
        while (!pending.isBlank()) {
            int cut = sentenceCut();
            if (cut <= 0 && pending.length() > LIMIT) {
                var clause = CLAUSE.matcher(pending.substring(0, LIMIT));
                while (clause.find()) if (clause.end() >= 45) cut = clause.end();
                if (cut <= 0) cut = pending.lastIndexOf(' ', LIMIT - 1);
                if (cut <= 0) cut = LIMIT;
            }
            if (cut <= 0 && done) cut = pending.length();
            if (cut <= 0) break;
            if (cut < pending.length() && Character.isLowSurrogate(pending.charAt(cut))) cut--;
            result.add(pending.substring(0, cut).strip());
            pending = pending.substring(cut).stripLeading();
        }
        return result;
    }

    private int sentenceCut() {
        var ends = SENTENCE.matcher(pending);
        while (ends.find() && ends.end() <= LIMIT) {
            if (!ABBREVIATION.matcher(pending.substring(0, ends.end())).find()) return ends.end();
        }
        return -1;
    }
}
