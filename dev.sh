#!/usr/bin/env sh
# Linux/macOS equivalent of dev.cmd
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")" || exit 1

# Snap-packaged editors (VS Code) export GTK/GIO paths pointing into their own
# runtime. A host-built binary then loads /snap/core20's libpthread against the
# host glibc and dies with "undefined symbol: __libc_pthread_init". Strip them.
# Trigger on the poisoned vars themselves, not just $SNAP — some terminals
# inherit GTK_PATH without the rest of the snap environment.
case "$SNAP$GTK_PATH$GIO_MODULE_DIR$GDK_PIXBUF_MODULE_FILE" in *snap*)
  unset GTK_PATH GTK_EXE_PREFIX GTK_IM_MODULE_FILE LOCPATH \
        GIO_MODULE_DIR GDK_PIXBUF_MODULE_FILE GDK_PIXBUF_MODULEDIR \
        GSETTINGS_SCHEMA_DIR LD_LIBRARY_PATH SNAP_LIBRARY_PATH SNAP
  export XDG_DATA_DIRS=/usr/local/share:/usr/share
  export XDG_DATA_HOME="$HOME/.local/share"
  echo "dev.sh: stripped snap GTK environment"
  ;;
esac

npm run tauri dev
