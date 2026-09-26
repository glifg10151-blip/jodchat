use crate::AppError;

pub(crate) const SERVICE: &str = "com.sythoria.sythoria-desktop";

fn account(namespace: &str, id: &str) -> String {
    format!("{namespace}:{id}")
}

pub(crate) fn set_secret(namespace: &str, id: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring_core::Entry::new(SERVICE, &account(namespace, id))
        .map_err(|error| AppError::ConfigIo(format!("Failed to access keychain: {error}")))?;
    entry
        .set_password(secret)
        .map_err(|error| AppError::ConfigIo(format!("Failed to save secret: {error}")))
}

pub(crate) fn get_secret(namespace: &str, id: &str) -> Result<String, AppError> {
    let entry = keyring_core::Entry::new(SERVICE, &account(namespace, id))
        .map_err(|error| AppError::ConfigIo(format!("Failed to access keychain: {error}")))?;
    entry.get_password().map_err(|error| match error {
        keyring_core::Error::NoEntry => AppError::KeyNotFound(format!("No key found for '{id}'")),
        _ => AppError::ConfigIo(format!("Failed to load secret: {error}")),
    })
}

pub(crate) fn delete_secret(namespace: &str, id: &str) -> Result<(), AppError> {
    let entry = keyring_core::Entry::new(SERVICE, &account(namespace, id))
        .map_err(|error| AppError::ConfigIo(format!("Failed to access keychain: {error}")))?;
    entry.delete_credential().or_else(|error| match error {
        keyring_core::Error::NoEntry => Ok(()),
        _ => Err(AppError::ConfigIo(format!(
            "Failed to delete secret: {error}"
        ))),
    })
}

pub(crate) fn init_store() {
    #[cfg(target_os = "macos")]
    keyring_core::set_default_store(
        apple_native_keyring_store::keychain::Store::new()
            .expect("Failed to init macOS Keychain store"),
    );
    #[cfg(target_os = "ios")]
    keyring_core::set_default_store(
        apple_native_keyring_store::protected::Store::new()
            .expect("Failed to init iOS Protected Data store"),
    );
    #[cfg(target_os = "windows")]
    keyring_core::set_default_store(
        windows_native_keyring_store::Store::new()
            .expect("Failed to init Windows Credential store"),
    );
    #[cfg(target_os = "linux")]
    keyring_core::set_default_store(
        dbus_secret_service_keyring_store::Store::new()
            .expect("Failed to init Linux Secret Service store"),
    );
}
