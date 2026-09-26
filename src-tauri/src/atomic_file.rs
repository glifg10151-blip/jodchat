use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

/// Replaces `path` only after the complete new value has been written and
/// flushed in the same directory. This prevents a crash from leaving a
/// truncated settings or conversation file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "file path has no parent"))?;
    fs::create_dir_all(parent)?;

    #[cfg(unix)]
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;

    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "file path has no valid filename",
            )
        })?;
    let temporary_path = parent.join(format!(".{filename}.{}.tmp", uuid::Uuid::new_v4()));

    let write_result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);

        let mut file = options.open(&temporary_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);

        fs::rename(&temporary_path, path)?;

        #[cfg(unix)]
        {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
            fs::File::open(parent)?.sync_all()?;
        }

        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

#[cfg(test)]
mod tests {
    use super::write_atomic;
    use std::fs;

    #[test]
    fn replaces_a_file_without_leaving_a_temporary_file() {
        let directory =
            std::env::temp_dir().join(format!("sythoria-atomic-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create fixture directory");
        let path = directory.join("settings.json");

        write_atomic(&path, b"first").expect("write first value");
        write_atomic(&path, b"second").expect("replace value");

        assert_eq!(fs::read(&path).expect("read value"), b"second");
        assert_eq!(
            fs::read_dir(&directory)
                .expect("read fixture directory")
                .filter_map(Result::ok)
                .count(),
            1
        );

        fs::remove_dir_all(directory).expect("remove fixture directory");
    }
}
