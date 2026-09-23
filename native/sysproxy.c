/*
 * lifevpn-proxy.exe — системный прокси Windows.
 *
 * Аналог networksetup в мак-версии. Настройки пишутся через WinINet
 * (INTERNET_OPTION_PER_CONNECTION_OPTION), а не прямо в реестр: так их сразу
 * видят все программы, и применяются они и к обычной сети, и к каждому
 * RAS-подключению (модем, PPPoE, встроенный VPN Windows) — у тех свои
 * настройки прокси, и правка одного только реестра их не задевает.
 *
 *   lifevpn-proxy.exe query                 -> flags\nserver\nbypass\nautoconfig
 *   lifevpn-proxy.exe set <server> <bypass> -> включить прокси
 *   lifevpn-proxy.exe restore <flags> <server> <bypass> <autoconfig>
 *   lifevpn-proxy.exe clear                 -> прямое подключение
 *
 * Пустые значения передаются как "-".
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
    BOOL ok = apply_one(NULL, flags, server, bypass, autoconfig);

    DWORD size = 0, entries = 0;
    RASENTRYNAMEW probe;
    probe.dwSize = sizeof(RASENTRYNAMEW);
    DWORD result = RasEnumEntriesW(NULL, NULL, NULL, &size, &entries);
    if ((result == ERROR_BUFFER_TOO_SMALL || result == 603) && size > 0) {
        LPRASENTRYNAMEW names = (LPRASENTRYNAMEW)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, size);
        if (names) {
            names[0].dwSize = sizeof(RASENTRYNAMEW);
            if (RasEnumEntriesW(NULL, NULL, names, &size, &entries) == ERROR_SUCCESS) {
                for (DWORD i = 0; i < entries; i++) {
                    apply_one(names[i].szEntryName, flags, server, bypass, autoconfig);
                }
            }
            HeapFree(GetProcessHeap(), 0, names);
        }
    }
    (void)probe;

    InternetSetOptionW(NULL, INTERNET_OPTION_SETTINGS_CHANGED, NULL, 0);
    InternetSetOptionW(NULL, INTERNET_OPTION_REFRESH, NULL, 0);

    if (!ok) {
        fwprintf(stderr, L"InternetSetOption failed: %lu\n", GetLastError());
        return 2;
    }
    return 0;
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

int wmain(int argc, wchar_t **argv) {
    if (argc < 2) {
        fwprintf(stderr, L"usage: lifevpn-proxy query | set <server> <bypass> | restore <flags> <server> <bypass> <autoconfig> | clear\n");
        return 1;
    }

    if (wcscmp(argv[1], L"query") == 0) {
        return query();
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
