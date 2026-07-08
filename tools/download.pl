#!/usr/bin/env perl
use strict;
use warnings;
use feature qw(say);
use Cwd qw(getcwd);
use File::Path qw(make_path);
use File::Spec;
use Getopt::Long qw(GetOptions);

my %models = (
    qwen_14 => {
        repo => 'bartowski/Qwen2.5-14B-Instruct-GGUF',
        file => 'Qwen2.5-14B-Instruct-Q6_K_L.gguf',
        out  => 'Qwen2.5-14B-Instruct-Q6_K_L.gguf',
        note => 'default, stronger 14B model, about 12.5 GB',
        size => 12501803136,
    },
    qwen_14_q4 => {
        repo => 'bartowski/Qwen2.5-14B-Instruct-GGUF',
        file => 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
        out  => 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
        note => 'smaller 14B model, about 9.0 GB',
        size => 8988110976,
    },
    qwen_1_5 => {
        repo => 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
        file => 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
        out  => 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
        note => 'small 1.5B model',
        size => 986680960,
    },
    qwen_coder_1_5 => {
        repo => 'bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF',
        file => 'Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf',
        out  => 'Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf',
        note => 'small 1.5B coder model',
        size => 986680960,
    },
);

my $model = 'qwen_14';
my $dir = File::Spec->catdir(getcwd(), 'run', 'models');
my $force = 0;
my $help = 0;

sub usage {
    my $available = join("\n", map {
        sprintf("    %-15s %s", $_, $models{$_}->{note} || '')
    } sort keys %models);
    return <<"USAGE";
Usage: $0 [--model NAME] [--dir DIR] [--force]

  --model NAME   Model preset to download. Default: qwen_14
                 Available:
$available
  --dir DIR      Destination directory. Default: ./run/models
  --force        Re-download even if the target file already exists
  --help         Show this help
USAGE
}

GetOptions(
    'model=s' => \$model,
    'dir=s'   => \$dir,
    'force'   => \$force,
    'help|h'  => \$help,
) or die usage();

if ($help) {
    print usage();
    exit 0;
}

die "Unknown model preset '$model'.\n" . usage() unless exists $models{$model};

my $entry = $models{$model};
my $repo = $entry->{repo};
my $file = $entry->{file};
my $output = File::Spec->catfile($dir, $entry->{out});
my $url = "https://huggingface.co/$repo/resolve/main/$file?download=true";

make_path($dir) unless -d $dir;

if (-f $output && !$force) {
    say "Model already exists: $output";
    say "Use --force to re-download.";
    exit 0;
}

my $tmp = "$output.tmp";
unlink $tmp if -f $tmp;

sub format_bytes {
    my ($bytes) = @_;
    return sprintf('%.2f GiB', $bytes / 1024 / 1024 / 1024) if $bytes >= 1024 * 1024 * 1024;
    return sprintf('%.1f MiB', $bytes / 1024 / 1024) if $bytes >= 1024 * 1024;
    return sprintf('%.1f KiB', $bytes / 1024) if $bytes >= 1024;
    return "$bytes B";
}

sub available_bytes {
    my ($path) = @_;
    open my $df, '-|', 'df', '-Pk', $path or return;
    my @lines = <$df>;
    close $df;
    my $line = $lines[-1] || '';
    my @parts = split /\s+/, $line;
    return unless @parts >= 4 && $parts[3] =~ /^\d+$/;
    return $parts[3] * 1024;
}

if ($entry->{size}) {
    my $available = available_bytes($dir);
    my $needed = $entry->{size} + (1024 * 1024 * 1024);
    if (defined $available && $available < $needed) {
        die "Not enough free space in $dir for $model. Need about "
            . format_bytes($needed)
            . " including buffer, available "
            . format_bytes($available)
            . ".\n";
    }
}

sub has_cmd {
    my ($cmd) = @_;
    system('sh', '-c', "command -v '$cmd' >/dev/null 2>&1");
    return $? == 0;
}

sub run_cmd {
    my (@cmd) = @_;
    say '+ ' . join(' ', @cmd);
    system @cmd;
    die "Command failed: @cmd\n" if $? != 0;
}

say "Downloading $model";
say "Source: $repo / $file";
say "Target: $output";

if (has_cmd('curl')) {
    run_cmd('curl', '-L', '--fail', '--retry', '3', '--continue-at', '-', '-o', $tmp, $url);
}
elsif (has_cmd('wget')) {
    run_cmd('wget', '-O', $tmp, $url);
}
else {
    die "Neither curl nor wget is available.\n";
}

rename $tmp, $output or die "Could not move $tmp to $output: $!\n";
say "Downloaded: $output";
