; Перед установкой и удалением закрываем работающий Life VPN и его ядро:
; иначе файлы заняты, а системный прокси может остаться включённым.
!macro customInit
  nsExec::Exec 'taskkill /IM "LifeVPN.exe" /F'
  nsExec::Exec 'taskkill /IM "xray.exe" /F'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /IM "LifeVPN.exe" /F'
  nsExec::Exec 'taskkill /IM "xray.exe" /F'
!macroend

; При удалении снимаем системный прокси, если приложение его оставило
; (след этого — proxy-state.json в папке данных).
!macro customUnInstall
  IfFileExists "$APPDATA\LifeVPN\proxy-state.json" 0 lifevpn_proxy_done
  IfFileExists "$INSTDIR\resources\bin\lifevpn-proxy.exe" 0 lifevpn_proxy_done
    nsExec::Exec '"$INSTDIR\resources\bin\lifevpn-proxy.exe" clear'
    Delete "$APPDATA\LifeVPN\proxy-state.json"
  lifevpn_proxy_done:
!macroend
