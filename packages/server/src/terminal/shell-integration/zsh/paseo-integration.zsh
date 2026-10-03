if [[ -n "${_PASEO_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _PASEO_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _PASEO_ZSH_COMMAND_ACTIVE=0

function _paseo_osc633() {
  printf '\e]633;%s\a' "$1"
}

# The shell's directory as a file:// URL, byte-wise percent-encoded, so a restore can start there.
function _paseo_osc7() {
  emulate -L zsh -o extendedglob
  local LC_ALL=C MATCH MBEGIN MEND
  printf '\e]7;file://%s%s\a' "$HOST" "${PWD//(#m)[^A-Za-z0-9\/._~-]/%${(l:2::0:)$(([##16]#MATCH))}}"
}

function _paseo_precmd() {
  local command_status=$?
  # Before D: the command-finished save then records where the command left the shell.
  _paseo_osc7
  if [[ "$_PASEO_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _paseo_osc633 "D;${command_status}"
    _PASEO_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _paseo_osc633 "A"
}

function _paseo_preexec() {
  _PASEO_ZSH_COMMAND_ACTIVE=1
  _paseo_osc633 "B"
  _paseo_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _paseo_precmd
add-zsh-hook preexec _paseo_preexec
