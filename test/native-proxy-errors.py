#!/usr/bin/env python3
"""Компилирует настоящие функции native/sysproxy.c против заглушек Windows API
(macOS/Linux, clang или gcc) и проверяет: агрегацию ошибок apply_all (LAN,
оба этапа RasEnumEntriesW, память, каждый профиль, SETTINGS_CHANGED и
REFRESH), разбор однозначного hex-протокола и restore_one (точечное
восстановление, отсутствующий профиль -> 3, повреждённые аргументы -> 1).
Не заменяет проверку на настоящей Windows."""
from pathlib import Path
import shutil, subprocess, tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'native/sysproxy.c').read_text()

def cut(start_marker, end_marker):
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    return source[start:end]

apply_all = cut('static int apply_all(', '\nstatic void print_value')
proto = cut('static void print_hex(', '\nstatic int wmain') if '\nstatic int wmain' in source else cut('static void print_hex(', '\nint wmain(')
# snapshot_one/snapshot требуют InternetQueryOptionW со структурами — выкидываем.
proto = proto[:proto.index('/* Снимок одного подключения')] + proto[proto.index('/* Имена RAS-профилей.'):]
proto = proto[:proto.index('static int snapshot(void)')] + proto[proto.index('static int notify_changed(void)'):]

pre = r'''
#include <stdio.h>
#include <wchar.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
typedef unsigned long DWORD; typedef int BOOL; typedef wchar_t *LPWSTR; typedef const wchar_t *LPCWSTR;
typedef struct {DWORD dwSize; wchar_t szEntryName[16];} RASENTRYNAMEW,*LPRASENTRYNAMEW;
#define TRUE 1
#define FALSE 0
#define ERROR_BUFFER_TOO_SMALL 603
#define ERROR_SUCCESS 0
#define ERROR_NOT_ENOUGH_MEMORY 8
#define HEAP_ZERO_MEMORY 0
#define INTERNET_OPTION_SETTINGS_CHANGED 1
#define INTERNET_OPTION_REFRESH 2
static int mode, applyCount, notifications;
static DWORD lastFlags; static wchar_t lastConn[32], lastServer[64], lastAuto[64];
static DWORD GetLastError(void){return 99;}
static BOOL apply_one(LPWSTR c,DWORD f,LPWSTR s,LPWSTR b,LPWSTR a){
  applyCount++; lastFlags=f;
  wcscpy(lastConn, c?c:L""); wcscpy(lastServer, s?s:L""); wcscpy(lastAuto, a?a:L"");
  (void)b; return !(mode==1&&!c)&&!(mode==2&&c);}
static DWORD RasEnumEntriesW(void*a,void*b,LPRASENTRYNAMEW n,DWORD*s,DWORD*e){(void)a;(void)b;
  if(mode==3)return 55; if(mode==4){*e=0;return 0;}
  if(!n){*s=2*sizeof(*n);*e=2;return 603;} if(mode==5)return 56;
  *e=2; wcscpy(n[0].szEntryName,L"a"); wcscpy(n[1].szEntryName,L"Рабочий VPN"); return 0;}
static void*GetProcessHeap(void){return NULL;}
static void*HeapAlloc(void*h,int f,size_t s){(void)h;(void)f;return mode==6?NULL:calloc(1,s);}
static void HeapFree(void*h,int f,void*p){(void)h;(void)f;free(p);}
static BOOL InternetSetOptionW(void*h,int o,void*p,DWORD s){(void)h;(void)p;(void)s;notifications++;return !(mode==7&&o==1)&&!(mode==8&&o==2);}
'''
post = r'''
static void hex_of(const wchar_t *s, wchar_t *out){ if(!*s){wcscpy(out,L"-");return;} out[0]=0; for(;*s;s++){wchar_t b[5]; swprintf(b,5,L"%04X",(unsigned)*s); wcscat(out,b);} }
int main(void){
  for(mode=0;mode<=8;mode++){applyCount=notifications=0;int r=apply_all(3,NULL,NULL,NULL);
    assert(r==((mode==0||mode==4)?0:2)); assert(notifications==2); if(mode==2)assert(applyCount==3);}
  puts("apply_all: 9 error-aggregation scenarios passed");

  mode=0; LPWSTR v=NULL;
  assert(parse_hex(L"-",&v) && v==NULL);
  assert(parse_hex(L"0420043004310063", &v) && wcscmp(v,L"Рабc")==0); free_value(v);
  assert(!parse_hex(L"041",&v)); assert(!parse_hex(L"zzzz",&v)); assert(!parse_hex(L"0000",&v)); assert(!parse_hex(L"",&v));
  puts("hex protocol: round-trip and malformed values passed");

  wchar_t name[128], server[128], autoc[128];
  hex_of(L"Рабочий VPN", name); hex_of(L"corp:8080", server); hex_of(L"http://wpad/p.pac", autoc);
  applyCount=notifications=0;
  assert(restore_one(name, L"5", server, L"-", autoc)==0);
  assert(applyCount==1 && lastFlags==5 && wcscmp(lastConn,L"Рабочий VPN")==0 && wcscmp(lastServer,L"corp:8080")==0 && wcscmp(lastAuto,L"http://wpad/p.pac")==0);
  assert(notifications==2);
  applyCount=0;
  assert(restore_one(L"-", L"1", L"-", L"-", L"-")==0 && applyCount==1 && lastConn[0]==0);
  wchar_t gone[64]; hex_of(L"Удалён", gone); applyCount=0;
  assert(restore_one(gone, L"1", L"-", L"-", L"-")==3 && applyCount==0);
  assert(restore_one(name, L"0", L"-", L"-", L"-")==1);
  assert(restore_one(name, L"5x", L"-", L"-", L"-")==1);
  assert(restore_one(L"12", L"5", L"-", L"-", L"-")==1);
  mode=2; assert(restore_one(name, L"5", L"-", L"-", L"-")==2);
  mode=5; assert(restore_one(name, L"5", L"-", L"-", L"-")==2);
  mode=7; assert(restore_one(L"-", L"1", L"-", L"-", L"-")==2);
  puts("restore_one: exact per-profile restore, missing profile=3, malformed=1, failures=2 passed");
  return 0;
}
'''
compiler = shutil.which('clang') or shutil.which('gcc') or shutil.which('cc')
with tempfile.TemporaryDirectory(prefix='lifevpn-native-test-') as folder:
    path = Path(folder)
    (path / 'test.c').write_text(pre + apply_all + proto + post)
    subprocess.run([compiler, '-std=c99', '-w', str(path / 'test.c'), '-o', str(path / 'test')], check=True)
    subprocess.run([str(path / 'test')], check=True)
print('Native proxy helper: passed (mocked Windows API)')
