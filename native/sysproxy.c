/*
 * lifevpn-proxy.exe — системный прокси Windows.
 *
 * Аналог networksetup в мак-версии. Настройки пишутся через WinINet
 * (INTERNET_OPTION_PER_CONNECTION_OPTION), а не прямо в реестр: так их сразу
 * видят все программы, и применяются они и к обычной сети, и к каждому
 * RAS-подключению (модем, PPPoE, встроенный VPN Windows) — у тех свои
 * настройки прокси, и правка одного только реестра их не задевает.
 *
 *   lifevpn-proxy.exe query                 -> flags\nserver\nbypass\nautoconfig (LAN)
 *   lifevpn-proxy.exe snapshot              -> снимок LAN и каждого RAS-профиля
 *   lifevpn-proxy.exe set <server> <bypass> -> включить прокси везде
 *   lifevpn-proxy.exe restore-one <name> <flags> <server> <bypass> <autoconfig>
 *                                           -> вернуть одно подключение
 *   lifevpn-proxy.exe restore <flags> <server> <bypass> <autoconfig>  (старый журнал)
 *   lifevpn-proxy.exe clear                 -> прямое подключение
 *
 * В query/restore/clear пустые значения передаются как "-".
 *
 * snapshot и restore-one говорят на однозначном протоколе: каждое значение —
 * hex кодовых единиц UTF-16 (4 цифры на единицу), пустое — "-", имя LAN —
 * "-". Так кириллица, пробелы и любые символы в именах RAS-профилей и
 * исключениях проходят без потерь и без экранирования.
 *
 *   LIFEVPN-PROXY-SNAPSHOT 2
 *   E <name> <flags> <server> <bypass> <autoconfig>
 *   ...
 *   END <число записей>
 *
 * Коды выхода: 0 — успех, 1 — неверные аргументы, 2 — ошибка Windows,
 * 3 — RAS-профиля с таким именем больше нет (restore-one).
 */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <wininet.h>
#include <ras.h>
#include <raserror.h>
#include <stdio.h>
#include <wchar.h>

static LPWSTR arg_or_null(LPWSTR value) {
    if (value == NULL || wcscmp(value, L"-") == 0 || value[0] == 0) return NULL;
    return value;
}

static BOOL apply_one(LPWSTR connection, DWORD flags, LPWSTR server, LPWSTR bypass, LPWSTR autoconfig) {
    INTERNET_PER_CONN_OPTIONW options[4];
    DWORD count = 0;

    options[count].dwOption = INTERNET_PER_CONN_FLAGS;
    options[count].Value.dwValue = flags;
    count++;

    options[count].dwOption = INTERNET_PER_CONN_PROXY_SERVER;
    options[count].Value.pszValue = server;
    count++;

    options[count].dwOption = INTERNET_PER_CONN_PROXY_BYPASS;
    options[count].Value.pszValue = bypass;
    count++;

    options[count].dwOption = INTERNET_PER_CONN_AUTOCONFIG_URL;
    options[count].Value.pszValue = autoconfig;
    count++;

    INTERNET_PER_CONN_OPTION_LISTW list;
    list.dwSize = sizeof(list);
    list.pszConnection = connection;
    list.dwOptionCount = count;
    list.dwOptionError = 0;
    list.pOptions = options;

    return InternetSetOptionW(NULL, INTERNET_OPTION_PER_CONNECTION_OPTION, &list, sizeof(list));
}

/* Применяет к локальной сети и ко всем RAS-подключениям. */
static int apply_all(DWORD flags, LPWSTR server, LPWSTR bypass, LPWSTR autoconfig) {
    BOOL ok = TRUE;
    if (!apply_one(NULL, flags, server, bypass, autoconfig)) {
        fwprintf(stderr, L"LAN proxy update failed: %lu\n", GetLastError());
        ok = FALSE;
    }
    DWORD size = 0, entries = 0;
    DWORD result = RasEnumEntriesW(NULL, NULL, NULL, &size, &entries);
    if (result == ERROR_BUFFER_TOO_SMALL && size > 0) {
        LPRASENTRYNAMEW names = (LPRASENTRYNAMEW)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, size);
        if (!names) {
            fwprintf(stderr, L"RAS allocation failed: %lu\n", (DWORD)ERROR_NOT_ENOUGH_MEMORY);
            ok = FALSE;
        } else {
            names[0].dwSize = sizeof(RASENTRYNAMEW);
            result = RasEnumEntriesW(NULL, NULL, names, &size, &entries);
            if (result != ERROR_SUCCESS) {
                fwprintf(stderr, L"RAS enumeration failed: %lu\n", result);
                ok = FALSE;
            } else {
                for (DWORD i = 0; i < entries; i++) {
                    if (!apply_one(names[i].szEntryName, flags, server, bypass, autoconfig)) {
                        fwprintf(stderr, L"RAS proxy update failed for %ls: %lu\n", names[i].szEntryName, GetLastError());
                        ok = FALSE;
                    }
                }
            }
            HeapFree(GetProcessHeap(), 0, names);
        }
    } else if (result != ERROR_SUCCESS || entries != 0) {
        fwprintf(stderr, L"RAS enumeration probe failed: %lu\n", result);
        ok = FALSE;
    }
    if (!InternetSetOptionW(NULL, INTERNET_OPTION_SETTINGS_CHANGED, NULL, 0)) {
        fwprintf(stderr, L"Proxy change notification failed: %lu\n", GetLastError());
        ok = FALSE;
    }
    if (!InternetSetOptionW(NULL, INTERNET_OPTION_REFRESH, NULL, 0)) {
        fwprintf(stderr, L"Proxy refresh notification failed: %lu\n", GetLastError());
        ok = FALSE;
    }
    return ok ? 0 : 2;
}

static void print_value(LPWSTR value) {
    if (value && value[0]) {
        wprintf(L"%ls\n", value);
    } else {
        wprintf(L"-\n");
    }
}

static int query(void) {
    INTERNET_PER_CONN_OPTIONW options[4];
    options[0].dwOption = INTERNET_PER_CONN_FLAGS;
    options[1].dwOption = INTERNET_PER_CONN_PROXY_SERVER;
    options[2].dwOption = INTERNET_PER_CONN_PROXY_BYPASS;
    options[3].dwOption = INTERNET_PER_CONN_AUTOCONFIG_URL;

    INTERNET_PER_CONN_OPTION_LISTW list;
    DWORD size = sizeof(list);
    list.dwSize = sizeof(list);
    list.pszConnection = NULL;
    list.dwOptionCount = 4;
    list.dwOptionError = 0;
    list.pOptions = options;

    if (!InternetQueryOptionW(NULL, INTERNET_OPTION_PER_CONNECTION_OPTION, &list, &size)) {
        fwprintf(stderr, L"InternetQueryOption failed: %lu\n", GetLastError());
        return 2;
    }

    wprintf(L"%lu\n", options[0].Value.dwValue);
    print_value(options[1].Value.pszValue);
    print_value(options[2].Value.pszValue);
    print_value(options[3].Value.pszValue);

    for (int i = 1; i < 4; i++) {
        if (options[i].Value.pszValue) GlobalFree(options[i].Value.pszValue);
    }
    return 0;
}

/* ---- Однозначный протокол снимка (hex UTF-16) ---- */

static void print_hex(LPCWSTR value) {
    if (!value || !value[0]) { wprintf(L"-"); return; }
    for (const wchar_t *p = value; *p; p++) wprintf(L"%04X", (unsigned)(*p & 0xFFFF));
}

/* Разбирает hex в новую строку (HeapAlloc). "-" -> NULL. FALSE — повреждено. */
static BOOL parse_hex(LPCWSTR text, LPWSTR *out) {
    *out = NULL;
    if (!text) return FALSE;
    if (wcscmp(text, L"-") == 0) return TRUE;
    size_t len = wcslen(text);
    if (len == 0 || len % 4 != 0 || len > 4 * 32768) return FALSE;
    LPWSTR value = (LPWSTR)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, (len / 4 + 1) * sizeof(wchar_t));
    if (!value) return FALSE;
    for (size_t i = 0; i < len / 4; i++) {
        unsigned unit = 0;
        for (int j = 0; j < 4; j++) {
            wchar_t c = text[i * 4 + j];
            unit <<= 4;
            if (c >= L'0' && c <= L'9') unit |= (unsigned)(c - L'0');
            else if (c >= L'A' && c <= L'F') unit |= (unsigned)(c - L'A' + 10);
            else if (c >= L'a' && c <= L'f') unit |= (unsigned)(c - L'a' + 10);
            else { HeapFree(GetProcessHeap(), 0, value); return FALSE; }
        }
        if (unit == 0) { HeapFree(GetProcessHeap(), 0, value); return FALSE; }
        value[i] = (wchar_t)unit;
    }
    *out = value;
    return TRUE;
}

static void free_value(LPWSTR value) {
    if (value) HeapFree(GetProcessHeap(), 0, value);
}

/* Снимок одного подключения (NULL — LAN). */
static BOOL snapshot_one(LPWSTR connection) {
    INTERNET_PER_CONN_OPTIONW options[4];
    options[0].dwOption = INTERNET_PER_CONN_FLAGS;
    options[1].dwOption = INTERNET_PER_CONN_PROXY_SERVER;
    options[2].dwOption = INTERNET_PER_CONN_PROXY_BYPASS;
    options[3].dwOption = INTERNET_PER_CONN_AUTOCONFIG_URL;
    for (int i = 1; i < 4; i++) options[i].Value.pszValue = NULL;

    INTERNET_PER_CONN_OPTION_LISTW list;
    DWORD size = sizeof(list);
    list.dwSize = sizeof(list);
    list.pszConnection = connection;
    list.dwOptionCount = 4;
    list.dwOptionError = 0;
    list.pOptions = options;

    if (!InternetQueryOptionW(NULL, INTERNET_OPTION_PER_CONNECTION_OPTION, &list, &size)) {
        fwprintf(stderr, L"InternetQueryOption failed for %ls: %lu\n", connection ? connection : L"LAN", GetLastError());
        return FALSE;
    }
    wprintf(L"E ");
    print_hex(connection);
    wprintf(L" %lu ", options[0].Value.dwValue);
    print_hex(options[1].Value.pszValue); wprintf(L" ");
    print_hex(options[2].Value.pszValue); wprintf(L" ");
    print_hex(options[3].Value.pszValue); wprintf(L"\n");
    for (int i = 1; i < 4; i++) {
        if (options[i].Value.pszValue) GlobalFree(options[i].Value.pszValue);
    }
    return TRUE;
}

/* Имена RAS-профилей. FALSE — перечисление не удалось (снимок неполный). */
static BOOL ras_names(LPRASENTRYNAMEW *names, DWORD *entries) {
    *names = NULL;
    *entries = 0;
    DWORD size = 0;
    DWORD result = RasEnumEntriesW(NULL, NULL, NULL, &size, entries);
    if (result == ERROR_SUCCESS && *entries == 0) return TRUE;
    if (result != ERROR_BUFFER_TOO_SMALL || size == 0) {
        fwprintf(stderr, L"RAS enumeration probe failed: %lu\n", result);
        return FALSE;
    }
    *names = (LPRASENTRYNAMEW)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, size);
    if (!*names) {
        fwprintf(stderr, L"RAS allocation failed: %lu\n", (DWORD)ERROR_NOT_ENOUGH_MEMORY);
        return FALSE;
    }
    (*names)[0].dwSize = sizeof(RASENTRYNAMEW);
    result = RasEnumEntriesW(NULL, NULL, *names, &size, entries);
    if (result != ERROR_SUCCESS) {
        fwprintf(stderr, L"RAS enumeration failed: %lu\n", result);
        HeapFree(GetProcessHeap(), 0, *names);
        *names = NULL;
        return FALSE;
    }
    return TRUE;
}

static int snapshot(void) {
    LPRASENTRYNAMEW names = NULL;
    DWORD entries = 0;
    if (!ras_names(&names, &entries)) return 2;
    BOOL ok = TRUE;
    wprintf(L"LIFEVPN-PROXY-SNAPSHOT 2\n");
    if (!snapshot_one(NULL)) ok = FALSE;
    for (DWORD i = 0; ok && i < entries; i++) {
        if (!snapshot_one(names[i].szEntryName)) ok = FALSE;
    }
    if (names) HeapFree(GetProcessHeap(), 0, names);
    if (!ok) return 2;
    wprintf(L"END %lu\n", entries + 1);
    return 0;
}

static int notify_changed(void) {
    BOOL ok = TRUE;
    if (!InternetSetOptionW(NULL, INTERNET_OPTION_SETTINGS_CHANGED, NULL, 0)) {
        fwprintf(stderr, L"Proxy change notification failed: %lu\n", GetLastError());
        ok = FALSE;
    }
    if (!InternetSetOptionW(NULL, INTERNET_OPTION_REFRESH, NULL, 0)) {
        fwprintf(stderr, L"Proxy refresh notification failed: %lu\n", GetLastError());
        ok = FALSE;
    }
    return ok;
}

/* Возвращает одно подключение точно к снимку. */
static int restore_one(LPCWSTR nameHex, LPCWSTR flagsText, LPCWSTR serverHex, LPCWSTR bypassHex, LPCWSTR autoHex) {
    LPWSTR name = NULL, server = NULL, bypass = NULL, autoconfig = NULL;
    wchar_t *end = NULL;
    unsigned long flags = wcstoul(flagsText, &end, 10);
    if (!end || *end != 0 || flags == 0 || flags > 0xFF ||
        !parse_hex(nameHex, &name) || !parse_hex(serverHex, &server) ||
        !parse_hex(bypassHex, &bypass) || !parse_hex(autoHex, &autoconfig)) {
        fwprintf(stderr, L"malformed restore-one arguments\n");
        free_value(name); free_value(server); free_value(bypass); free_value(autoconfig);
        return 1;
    }
    int code = 0;
    if (name) {
        LPRASENTRYNAMEW names = NULL;
        DWORD entries = 0;
        if (!ras_names(&names, &entries)) {
            code = 2;
        } else {
            BOOL found = FALSE;
            for (DWORD i = 0; i < entries; i++) {
                if (wcscmp(names[i].szEntryName, name) == 0) { found = TRUE; break; }
            }
            if (names) HeapFree(GetProcessHeap(), 0, names);
            if (!found) code = 3;
        }
    }
    if (code == 0 && !apply_one(name, (DWORD)flags, server, bypass, autoconfig)) {
        fwprintf(stderr, L"Proxy restore failed for %ls: %lu\n", name ? name : L"LAN", GetLastError());
        code = 2;
    }
    if (code == 0 && !notify_changed()) code = 2;
    free_value(name); free_value(server); free_value(bypass); free_value(autoconfig);
    return code;
}

int wmain(int argc, wchar_t **argv) {
    if (argc < 2) {
        fwprintf(stderr, L"usage: lifevpn-proxy query | snapshot | set <server> <bypass> | restore-one <name> <flags> <server> <bypass> <autoconfig> | restore <flags> <server> <bypass> <autoconfig> | clear\n");
        return 1;
    }

    if (wcscmp(argv[1], L"query") == 0) {
        return query();
    }

    if (wcscmp(argv[1], L"snapshot") == 0) {
        return snapshot();
    }

    if (wcscmp(argv[1], L"restore-one") == 0 && argc == 7) {
        return restore_one(argv[2], argv[3], argv[4], argv[5], argv[6]);
    }

    if (wcscmp(argv[1], L"set") == 0 && argc >= 4) {
        return apply_all(PROXY_TYPE_DIRECT | PROXY_TYPE_PROXY,
                         arg_or_null(argv[2]), arg_or_null(argv[3]), NULL);
    }

    if (wcscmp(argv[1], L"restore") == 0 && argc >= 6) {
        DWORD flags = (DWORD)wcstoul(argv[2], NULL, 10);
        if (flags == 0) flags = PROXY_TYPE_DIRECT;
        return apply_all(flags, arg_or_null(argv[3]), arg_or_null(argv[4]), arg_or_null(argv[5]));
    }

    if (wcscmp(argv[1], L"clear") == 0) {
        return apply_all(PROXY_TYPE_DIRECT, NULL, NULL, NULL);
    }

    fwprintf(stderr, L"unknown command\n");
    return 1;
}
